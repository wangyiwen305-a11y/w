
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

interface ParticleExperienceProps {
  onBack: () => void;
}

const ParticleExperience: React.FC<ParticleExperienceProps> = ({ onBack }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("INITIALIZING PARTICLE ENGINE...");
  const [activeShapeName, setActiveShapeName] = useState("ASTROID TORUS");

  // --- Constants ---
  const PARTICLE_COUNT = 50000;
  const MORPH_SPEED = 0.08;
  const PINCH_THRESHOLD = 0.04;
  
  // --- Refs for Animation Loop ---
  const stateRef = useRef({
    currentShapeIndex: 0,
    targetRotation: { x: 0, y: 0 },
    targetScale: 1.0,
    isPinching: false,
    lastPinchTime: 0,
  });

  useEffect(() => {
    let handLandmarker: HandLandmarker | null = null;
    let animationId: number;
    let renderer: THREE.WebGLRenderer;
    let composer: EffectComposer;
    let camera: THREE.PerspectiveCamera;
    let particles: THREE.Points;
    let material: THREE.ShaderMaterial;
    
    // Geometry Buffers
    const posCurrent = new Float32Array(PARTICLE_COUNT * 3);
    const targets: Float32Array[] = []; // Stores A, B, C, D shapes

    // --- 1. Shape Generation Functions ---

    // Shape A: Astroid Torus (from User's Math)
    const generateAstroidTorus = () => {
        const arr = new Float32Array(PARTICLE_COUNT * 3);
        const R = 2.5; // Major radius
        const r = 1.0; // Minor radius
        for(let i = 0; i < PARTICLE_COUNT; i++) {
            const u = Math.random() * Math.PI * 2;
            const v = Math.random() * Math.PI * 2;
            
            // Astroid Torus Parametric Formula
            // x = (R + r * cos^3(v)) * cos(u)
            // y = r * sin^3(v)
            // z = (R + r * cos^3(v)) * sin(u)
            
            const cos3v = Math.pow(Math.cos(v), 3);
            const sin3v = Math.pow(Math.sin(v), 3);
            
            arr[i*3] = (R + r * cos3v) * Math.cos(u);
            arr[i*3+1] = r * sin3v;
            arr[i*3+2] = (R + r * cos3v) * Math.sin(u);
        }
        return arr;
    };

    // Shape B: Liquid Metal Sphere + Rings
    const generateLiquidSphere = () => {
        const arr = new Float32Array(PARTICLE_COUNT * 3);
        for(let i = 0; i < PARTICLE_COUNT; i++) {
            // 70% Sphere, 30% Rings
            if (i < PARTICLE_COUNT * 0.7) {
                // Sphere
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const r = 2.0;
                arr[i*3] = r * Math.sin(phi) * Math.cos(theta);
                arr[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
                arr[i*3+2] = r * Math.cos(phi);
            } else {
                // Orbital Rings
                const angle = Math.random() * Math.PI * 2;
                const r = 3.5 + Math.random() * 0.2; // Thin ring
                // Ring 1 (Horizontal) or Ring 2 (Tilted)
                if (Math.random() > 0.5) {
                    arr[i*3] = r * Math.cos(angle);
                    arr[i*3+1] = (Math.random()-0.5) * 0.2;
                    arr[i*3+2] = r * Math.sin(angle);
                } else {
                    const x = r * Math.cos(angle);
                    const y = r * Math.sin(angle);
                    // Rotate 45 deg on X
                    arr[i*3] = x;
                    arr[i*3+1] = y * Math.cos(Math.PI/4);
                    arr[i*3+2] = y * Math.sin(Math.PI/4);
                }
            }
        }
        return arr;
    };

    // Shape C: Icosahedron Structure (Sacred Geometry)
    const generateIcosahedron = () => {
        const arr = new Float32Array(PARTICLE_COUNT * 3);
        const phi = (1 + Math.sqrt(5)) / 2;
        const size = 1.8;
        
        // Vertices of Icosahedron
        const vertices = [
            [-1,  phi, 0], [ 1,  phi, 0], [-1, -phi, 0], [ 1, -phi, 0],
            [ 0, -1,  phi], [ 0,  1,  phi], [ 0, -1, -phi], [ 0,  1, -phi],
            [ phi, 0, -1], [ phi, 0,  1], [-phi, 0, -1], [-phi, 0,  1]
        ].map(v => new THREE.Vector3(v[0], v[1], v[2]).multiplyScalar(size));

        for(let i = 0; i < PARTICLE_COUNT; i++) {
            // Distribute particles along lines between random vertices to create a wireframe structure
            const v1 = vertices[Math.floor(Math.random() * vertices.length)];
            const v2 = vertices[Math.floor(Math.random() * vertices.length)];
            
            const t = Math.random();
            // Linear interpolation
            arr[i*3] = v1.x + (v2.x - v1.x) * t;
            arr[i*3+1] = v1.y + (v2.y - v1.y) * t;
            arr[i*3+2] = v1.z + (v2.z - v1.z) * t;
            
            // Add noise for volume
            arr[i*3] += (Math.random() - 0.5) * 0.2;
            arr[i*3+1] += (Math.random() - 0.5) * 0.2;
            arr[i*3+2] += (Math.random() - 0.5) * 0.2;
        }
        return arr;
    };

    // Shape D: Lorenz Attractor (The "Dragon")
    const generateDragonCurve = () => {
        const arr = new Float32Array(PARTICLE_COUNT * 3);
        let x = 0.1, y = 0, z = 0;
        const sigma = 10;
        const beta = 8.0/3.0;
        const rho = 28;
        const dt = 0.004;

        // Trace the attractor
        // We restart trace multiple times to get density
        let iter = 0;
        for(let i = 0; i < PARTICLE_COUNT; i++) {
            const dx = sigma * (y - x) * dt;
            const dy = (x * (rho - z) - y) * dt;
            const dz = (x * y - beta * z) * dt;
            x += dx;
            y += dy;
            z += dz;

            // Scaling down
            arr[i*3] = x * 0.15;
            arr[i*3+1] = (y * 0.15) - 2.0; // Center it vertically
            arr[i*3+2] = z * 0.15 - 4.0;   // Center depth
            
            iter++;
            // Reset occasionally to fill volume
            if(iter > 1000 && Math.random() > 0.99) {
                x = (Math.random()-0.5) * 10;
                y = (Math.random()-0.5) * 10;
                z = (Math.random()-0.5) * 10;
                iter = 0;
            }
        }
        return arr;
    };


    // --- 2. Initialize Three.js ---
    const initThree = () => {
        if (!mountRef.current) return;

        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;

        // Scene
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x000000, 0.04); // Deep depth

        // Camera
        camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
        camera.position.z = 8;
        camera.position.y = 0;

        // Renderer
        renderer = new THREE.WebGLRenderer({ 
            antialias: false, 
            powerPreference: "high-performance",
            alpha: true 
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mountRef.current.appendChild(renderer.domElement);

        // Post-Processing (Bloom)
        const renderScene = new RenderPass(scene, camera);
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
        bloomPass.strength = 1.8; // Intense glow
        bloomPass.radius = 0.4;
        bloomPass.threshold = 0.1;

        composer = new EffectComposer(renderer);
        composer.addPass(renderScene);
        composer.addPass(bloomPass);

        // --- Generate Shapes ---
        targets.push(generateAstroidTorus());
        targets.push(generateLiquidSphere());
        targets.push(generateIcosahedron());
        targets.push(generateDragonCurve());

        // Initial positions (start at A)
        posCurrent.set(targets[0]);

        // Geometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(posCurrent, 3));

        // Shader Material for Metallic/Glassy Particles
        material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColorA: { value: new THREE.Color(0xffffff) }, // White core
                uColorB: { value: new THREE.Color(0x00aaff) }, // Cyan rim
            },
            vertexShader: `
                uniform float uTime;
                varying float vDist;
                
                void main() {
                    vec3 pos = position;
                    // Subtle breathing
                    pos += normal * sin(uTime * 2.0 + pos.y) * 0.02;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    
                    vDist = length(mvPosition.xyz);
                    
                    // Size attenuation
                    gl_PointSize = 4.0 * (10.0 / -mvPosition.z);
                }
            `,
            fragmentShader: `
                uniform vec3 uColorA;
                uniform vec3 uColorB;
                varying float vDist;

                void main() {
                    // Circular soft particle
                    vec2 circ = gl_PointCoord - 0.5;
                    float r = length(circ);
                    if (r > 0.5) discard;
                    
                    // Glassy/Metallic Gradient
                    // Center is bright (White), Edge is colored
                    float intensity = 1.0 - (r * 2.0);
                    intensity = pow(intensity, 1.5);
                    
                    // Mix colors based on radial dist
                    vec3 col = mix(uColorB, uColorA, intensity * 1.5);
                    
                    gl_FragColor = vec4(col, intensity * 0.8);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        particles = new THREE.Points(geometry, material);
        scene.add(particles);

        // --- Animation Loop ---
        const clock = new THREE.Clock();

        const animate = () => {
            animationId = requestAnimationFrame(animate);
            const delta = clock.getDelta();
            const time = clock.getElapsedTime();

            // Update Shader
            material.uniforms.uTime.value = time;

            // 1. Morphing Logic (CPU Lerp)
            // We use CPU lerp for complex shape transitions to avoid strict vertex count matching constraints in shaders
            // and allowing arbitrary math formulas.
            const targetPos = targets[stateRef.current.currentShapeIndex];
            const currentPosAttribute = particles.geometry.attributes.position;
            const currentArr = currentPosAttribute.array as Float32Array;

            for(let i = 0; i < PARTICLE_COUNT * 3; i++) {
                // Lerp current to target
                const diff = targetPos[i] - currentArr[i];
                // Non-linear ease out for smoother snapping
                currentArr[i] += diff * MORPH_SPEED; 
            }
            currentPosAttribute.needsUpdate = true;

            // 2. Interaction Logic (Rotation & Scale)
            const targetRot = stateRef.current.targetRotation;
            const targetScale = stateRef.current.targetScale;

            // Smooth damping for rotation
            particles.rotation.x += (targetRot.x - particles.rotation.x) * 0.05;
            particles.rotation.y += (targetRot.y - particles.rotation.y) * 0.05;
            
            // Smooth damping for scale
            const currentScale = particles.scale.x;
            const newScale = currentScale + (targetScale - currentScale) * 0.1;
            particles.scale.set(newScale, newScale, newScale);
            
            // Subtle idle rotation
            particles.rotation.z += 0.001;

            composer.render();
        };

        animate();
    };

    // --- 3. MediaPipe Logic ---
    const setupVision = async () => {
        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
            );
            
            const handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1
            });

            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.addEventListener("loadeddata", () => {
                        setLoading(false);
                        setStatusText("SYSTEM ACTIVE. AWAITING INPUT.");
                        
                        const shapeNames = ["ASTROID TORUS", "LIQUID METAL", "ICOSAHEDRON", "DRAGON CHAOS"];
                        
                        // Prediction Loop
                        let lastVideoTime = -1;
                        const predict = () => {
                            if (!handLandmarker || !videoRef.current) return;
                            if (videoRef.current.currentTime !== lastVideoTime) {
                                lastVideoTime = videoRef.current.currentTime;
                                const result = handLandmarker.detectForVideo(videoRef.current, performance.now());
                                
                                if (result.landmarks && result.landmarks.length > 0) {
                                    const lm = result.landmarks[0];
                                    
                                    // A. ROTATION (Palm Position)
                                    // Map x (0-1) to rotation (-1 to 1 rad approx)
                                    const x = (lm[0].x - 0.5) * 4; 
                                    const y = (lm[0].y - 0.5) * 4;
                                    stateRef.current.targetRotation.y = x;
                                    stateRef.current.targetRotation.x = y;

                                    // B. ZOOM (Spread: ThumbTip to PinkyTip)
                                    const spread = Math.hypot(lm[4].x - lm[20].x, lm[4].y - lm[20].y);
                                    // Normal spread is ~0.4. Fist is ~0.1
                                    // Map 0.1->0.5 to Scale 0.5->1.5
                                    stateRef.current.targetScale = 0.5 + (spread * 2.5);

                                    // C. MORPH TRIGGER (Pinch: ThumbTip to IndexTip)
                                    const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
                                    const now = Date.now();
                                    
                                    if (pinchDist < PINCH_THRESHOLD) {
                                        if (!stateRef.current.isPinching && (now - stateRef.current.lastPinchTime > 1000)) {
                                            // Trigger Next Shape
                                            stateRef.current.isPinching = true;
                                            stateRef.current.lastPinchTime = now;
                                            
                                            stateRef.current.currentShapeIndex = (stateRef.current.currentShapeIndex + 1) % 4;
                                            setActiveShapeName(shapeNames[stateRef.current.currentShapeIndex]);
                                        }
                                    } else {
                                        stateRef.current.isPinching = false;
                                    }
                                } else {
                                    // Idle return to center
                                    stateRef.current.targetRotation.x = 0;
                                    stateRef.current.targetRotation.y = 0;
                                    stateRef.current.targetScale = 1.0;
                                }
                            }
                            requestAnimationFrame(predict);
                        };
                        predict();
                    });
                }
            }
        } catch (e) {
            console.error(e);
            setStatusText("ERROR: CAMERA ACCESS FAILED");
        }
    };

    // --- Init ---
    // Handle Window Resize
    const handleResize = () => {
        if (!mountRef.current || !renderer || !composer) return;
        const w = mountRef.current.clientWidth;
        const h = mountRef.current.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        composer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);
    initThree();
    setupVision();

    return () => {
        cancelAnimationFrame(animationId);
        window.removeEventListener('resize', handleResize);
        if (videoRef.current && videoRef.current.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        }
        if (mountRef.current && renderer) {
            mountRef.current.removeChild(renderer.domElement);
            renderer.dispose();
            if (composer) composer.dispose();
        }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black overflow-hidden font-sans select-none">
       {/* Hidden Video for MediaPipe */}
       <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-1 h-1" autoPlay playsInline muted></video>

       {/* Canvas Container */}
       <div ref={mountRef} className="w-full h-full cursor-move"></div>

       {/* Loading Overlay */}
       {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black/90">
                <div className="w-16 h-16 border-4 border-t-cyan-500 border-gray-900 rounded-full animate-spin mb-6"></div>
                <div className="text-cyan-400 tracking-[0.4em] text-xs font-bold animate-pulse">{statusText}</div>
            </div>
       )}

       {/* HUD */}
       <div className="absolute top-0 left-0 w-full h-full pointer-events-none p-8 flex flex-col justify-between">
           {/* Header */}
           <div className="flex justify-between items-start">
               <div>
                   <h1 className="text-4xl font-black text-white/90 tracking-tighter">MORPH</h1>
                   <div className="h-1 w-20 bg-gradient-to-r from-cyan-500 to-blue-600 mt-2"></div>
               </div>
               
               <div className="text-right">
                    <div className="text-xs text-cyan-400 font-bold tracking-[0.2em] mb-1">CURRENT FORM</div>
                    <div className="text-2xl font-light text-white tracking-widest uppercase animate-fade-in key={activeShapeName}">{activeShapeName}</div>
               </div>
           </div>

           {/* Controls Hint */}
           <div className="flex flex-col items-center gap-2 opacity-60">
                <div className="flex items-center gap-6 text-[10px] tracking-[0.2em] uppercase text-white/80">
                    <span className="flex items-center gap-2"><div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></div> PINCH TO MORPH</span>
                    <span className="flex items-center gap-2"><div className="w-2 h-2 bg-blue-500 rounded-full"></div> MOVE TO ROTATE</span>
                    <span className="flex items-center gap-2"><div className="w-2 h-2 bg-purple-500 rounded-full"></div> SPREAD TO ZOOM</span>
                </div>
           </div>
       </div>

       {/* Back Button */}
       <button 
          onClick={onBack}
          className="absolute top-8 right-8 pointer-events-auto group"
       >
          <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center bg-black/50 backdrop-blur-md group-hover:bg-white/10 transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-white/70 group-hover:text-white">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
       </button>
    </div>
  );
};

export default ParticleExperience;

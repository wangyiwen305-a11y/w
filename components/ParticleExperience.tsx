
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FilesetResolver, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';

interface ParticleExperienceProps {
  onBack: () => void;
}

const PARTICLE_COUNT = 25000;
const PARTICLE_SIZE = 0.08;

const ParticleExperience: React.FC<ParticleExperienceProps> = ({ onBack }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mutable state for animation loop
  const stateRef = useRef({
      currentShape: 0, // 0: Sphere, 1: Möbius, 2: Icosahedron
      isPinching: false,
      targetRotation: { x: 0, y: 0 },
  });

  useEffect(() => {
    let handLandmarker: HandLandmarker | null = null;
    let animationId: number;
    let renderer: THREE.WebGLRenderer;
    let composer: EffectComposer;
    let particles: THREE.Points;
    let camera: THREE.PerspectiveCamera;

    // Arrays for morph targets
    const posSphere = new Float32Array(PARTICLE_COUNT * 3);
    const posMobius = new Float32Array(PARTICLE_COUNT * 3);
    const posIcosa = new Float32Array(PARTICLE_COUNT * 3);
    const currentPositions = new Float32Array(PARTICLE_COUNT * 3);

    // --- 1. Generate Geometry Data ---
    const initGeometryData = () => {
        // Sphere (Fibonacci)
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const phi = Math.acos(1 - 2 * (i + 0.5) / PARTICLE_COUNT);
            const theta = Math.PI * (1 + 5**0.5) * (i + 0.5);
            const r = 1.8;
            
            posSphere[i*3] = r * Math.sin(phi) * Math.cos(theta);
            posSphere[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
            posSphere[i*3+2] = r * Math.cos(phi);
            
            // Start with sphere
            currentPositions[i*3] = posSphere[i*3];
            currentPositions[i*3+1] = posSphere[i*3+1];
            currentPositions[i*3+2] = posSphere[i*3+2];
        }

        // Möbius Strip
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const u = (i / PARTICLE_COUNT) * Math.PI * 2 * 2; 
            const v = (Math.random() * 2 - 1) * 0.6; 
            const radius = 1.4;

            posMobius[i*3] = (radius + v/2 * Math.cos(u/2)) * Math.cos(u);
            posMobius[i*3+1] = (radius + v/2 * Math.cos(u/2)) * Math.sin(u);
            posMobius[i*3+2] = v/2 * Math.sin(u/2);
            
            posMobius[i*3] += (Math.random() - 0.5) * 0.1;
            posMobius[i*3+1] += (Math.random() - 0.5) * 0.1;
            posMobius[i*3+2] += (Math.random() - 0.5) * 0.1;
        }

        // Icosahedron Cloud
        const t = (1 + Math.sqrt(5)) / 2;
        const verts = [
            {x:-1,y:t,z:0}, {x:1,y:t,z:0}, {x:-1,y:-t,z:0}, {x:1,y:-t,z:0},
            {x:0,y:-1,z:t}, {x:0,y:1,z:t}, {x:0,y:-1,z:-t}, {x:0,y:1,z:-t},
            {x:t,y:0,z:-1}, {x:t,y:0,z:1}, {x:-t,y:0,z:-1}, {x:-t,y:0,z:1}
        ];
        
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const vIdx = Math.floor(Math.random() * verts.length);
            const v = verts[vIdx];
            const scatter = 1.0; 
            posIcosa[i*3] = v.x + (Math.random() - 0.5) * scatter;
            posIcosa[i*3+1] = v.y + (Math.random() - 0.5) * scatter;
            posIcosa[i*3+2] = v.z + (Math.random() - 0.5) * scatter;
        }
    };

    // --- 2. Initialize Three.js ---
    const initThree = () => {
        if (!mountRef.current) return;

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x050505, 0.03);

        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        
        camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
        camera.position.z = 4.5;

        renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", alpha: false });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mountRef.current.appendChild(renderer.domElement);

        // Post Processing
        const renderScene = new RenderPass(scene, camera);
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0;
        bloomPass.strength = 2.0; 
        bloomPass.radius = 0.5;

        composer = new EffectComposer(renderer);
        composer.addPass(renderScene);
        composer.addPass(bloomPass);

        // Particles
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));
        
        const material = new THREE.ShaderMaterial({
            uniforms: {
                colorA: { value: new THREE.Color(0x0044ff) },
                colorB: { value: new THREE.Color(0x00ffff) },
                time: { value: 0 }
            },
            vertexShader: `
                uniform float time;
                varying vec3 vColor;
                uniform vec3 colorA;
                uniform vec3 colorB;

                void main() {
                    vec3 pos = position;
                    // Add subtle breathing motion
                    pos += normal * sin(time * 2.0 + position.y) * 0.05;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    
                    // Size attenuation based on depth
                    gl_PointSize = ${PARTICLE_SIZE.toFixed(2)} * (300.0 / -mvPosition.z);
                    
                    // Gradient color based on position
                    float mixVal = (position.y + 2.0) / 4.0;
                    vColor = mix(colorA, colorB, mixVal);
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    // Circular soft particle
                    float r = distance(gl_PointCoord, vec2(0.5));
                    if (r > 0.5) discard;
                    
                    // Glow falloff
                    float glow = 1.0 - (r * 2.0);
                    glow = pow(glow, 2.0); 
                    
                    gl_FragColor = vec4(vColor, glow); 
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        particles = new THREE.Points(geometry, material);
        scene.add(particles);

        const clock = new THREE.Clock();

        const animate = () => {
            animationId = requestAnimationFrame(animate);
            const time = clock.getElapsedTime();
            
            if (material) material.uniforms.time.value = time;

            // 1. Morph Logic
            const positions = particles.geometry.attributes.position.array as Float32Array;
            let targetArray;
            
            if (stateRef.current.currentShape === 0) targetArray = posSphere;
            else if (stateRef.current.currentShape === 1) targetArray = posMobius;
            else targetArray = posIcosa;

            const lerpFactor = 0.05;

            for (let i = 0; i < PARTICLE_COUNT * 3; i++) {
                positions[i] += (targetArray[i] - positions[i]) * lerpFactor;
            }
            particles.geometry.attributes.position.needsUpdate = true;

            // 2. Rotation
            particles.rotation.x += (stateRef.current.targetRotation.x - particles.rotation.x) * 0.05;
            particles.rotation.y += (stateRef.current.targetRotation.y - particles.rotation.y) * 0.05;
            particles.rotation.z += 0.001; // Idle rotation

            composer.render();
        };

        animate();
    };

    // --- 3. Initialize MediaPipe ---
    const setupMediaPipe = async () => {
        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
            );
            
            handLandmarker = await HandLandmarker.createFromOptions(vision, {
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
                        predictWebcam();
                    });
                }
            } else {
                throw new Error("No camera found");
            }
        } catch (e) {
            console.error(e);
            setError("Camera access denied or unavailable.");
            setLoading(false);
        }
    };

    const predictWebcam = () => {
        if (!handLandmarker || !videoRef.current) return;
        
        if (videoRef.current.videoWidth > 0 && !videoRef.current.paused) {
           const startTimeMs = performance.now();
           const result = handLandmarker.detectForVideo(videoRef.current, startTimeMs);
           
           if (result.landmarks && result.landmarks.length > 0) {
               const landmarks = result.landmarks[0];
               
               // Pinch Detection (Thumb tip 4 vs Index tip 8)
               const thumb = landmarks[4];
               const index = landmarks[8];
               const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
               const PINCH_THRESHOLD = 0.05;

               if (dist < PINCH_THRESHOLD) {
                   if (!stateRef.current.isPinching) {
                       stateRef.current.isPinching = true;
                       // Trigger Morph
                       stateRef.current.currentShape = (stateRef.current.currentShape + 1) % 3;
                   }
               } else {
                   stateRef.current.isPinching = false;
               }

               // Rotation Control (Wrist 0)
               // x: 0 (left) -> 1 (right)
               // y: 0 (top) -> 1 (bottom)
               const wrist = landmarks[0];
               const targetX = (wrist.x - 0.5) * 4;
               const targetY = (wrist.y - 0.5) * 4;
               
               stateRef.current.targetRotation.x = targetY; 
               stateRef.current.targetRotation.y = targetX;
           }
        }
        requestAnimationFrame(predictWebcam);
    };

    const handleResize = () => {
        if (!mountRef.current || !camera || !renderer || !composer) return;
        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        composer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    initGeometryData();
    setupMediaPipe();
    initThree();

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
            if (particles) {
                particles.geometry.dispose();
                (particles.material as THREE.Material).dispose();
            }
        }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black text-white font-sans select-none">
       {/* Hidden Video for MediaPipe */}
       <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-1 h-1" autoPlay playsInline muted></video>

       {/* Loading Overlay */}
       {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black/90">
                <div className="w-12 h-12 border-4 border-t-cyan-400 border-white/20 rounded-full animate-spin mb-4"></div>
                <div className="text-cyan-400 tracking-[0.3em] text-sm animate-pulse">INITIALIZING NEURAL LINK...</div>
            </div>
       )}
       
       {/* Error Overlay */}
       {error && (
           <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black/90">
               <div className="text-red-500 font-bold mb-4">{error}</div>
               <button onClick={onBack} className="px-4 py-2 border border-white/20 rounded hover:bg-white/10">Back</button>
           </div>
       )}

       {/* Canvas Container */}
       <div ref={mountRef} className="w-full h-full cursor-none"></div>

       {/* UI Overlay */}
       <div className="absolute bottom-8 left-0 w-full text-center pointer-events-none">
            <p className="text-white/70 text-xs tracking-[0.2em] uppercase drop-shadow-[0_0_10px_rgba(0,255,255,0.5)]">
                <span className="text-cyan-400 font-bold">Pinch</span> to Morph Shape &nbsp;|&nbsp; <span className="text-cyan-400 font-bold">Move Hand</span> to Rotate
            </p>
       </div>

       {/* Exit Button */}
       <button 
          onClick={onBack}
          className="absolute top-8 left-8 text-white/50 hover:text-white transition-colors flex items-center gap-2 z-40 bg-black/20 p-2 rounded-full backdrop-blur-sm border border-white/10"
       >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          <span className="text-xs uppercase tracking-widest pr-2">Exit</span>
       </button>
    </div>
  );
};

export default ParticleExperience;

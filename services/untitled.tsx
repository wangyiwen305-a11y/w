
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

interface ParticleExperienceProps {
  onBack: () => void;
}

type HandModel = 'skeleton' | 'joints' | 'web';

interface Connection {
    id: string;
    p1Idx: number; // Index in Hand 1
    p2Idx: number; // Index in Hand 2
}

// Helper for linear interpolation to smooth jitter
const lerp = (start: number, end: number, factor: number) => start + (end - start) * factor;

const ParticleExperience: React.FC<ParticleExperienceProps> = ({ onBack }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // UI State
  const [loading, setLoading] = useState(true);
  const [baseColor, setBaseColor] = useState<string>('#ffffff');
  const [handModel, setHandModel] = useState<HandModel>('skeleton');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [statusText, setStatusText] = useState("Initializing Neural Interface...");
  const [connectionCount, setConnectionCount] = useState(0);

  // Connection State
  const activeConnectionsRef = useRef<Connection[]>([]);

  // Performance Throttling
  const lastPredictionTimeRef = useRef(0);

  // Data Refs for Smoothing
  const landmarksRef = useRef<{
    hand1Target: any[] | null;
    hand2Target: any[] | null;
    hand1Current: any[] | null;
    hand2Current: any[] | null;
  }>({
    hand1Target: null,
    hand2Target: null,
    hand1Current: null,
    hand2Current: null
  });

  // Scene Refs
  const sceneRef = useRef<{
    hand1Points: THREE.Points;
    hand2Points: THREE.Points;
    hand1Lines: THREE.LineSegments;
    hand2Lines: THREE.LineSegments;
    connectorLines: THREE.LineSegments;
    material: THREE.LineBasicMaterial;
    stringMaterial: THREE.LineBasicMaterial;
    pointMaterial: THREE.PointsMaterial;
    bloomPass: UnrealBloomPass;
  } | null>(null);

  const colorRef = useRef(new THREE.Color('#ffffff'));
  const lastVideoTimeRef = useRef(-1);

  // Update color ref when state changes
  useEffect(() => {
    colorRef.current.set(baseColor);
    if (sceneRef.current) {
        // Boost intensity if white
        const intensity = baseColor.toLowerCase() === '#ffffff' ? 2.0 : 1.0;
        sceneRef.current.material.color.copy(colorRef.current);
        sceneRef.current.pointMaterial.color.copy(colorRef.current);
        
        // Strings are always WHITE and GLOWING
        sceneRef.current.stringMaterial.color.setHex(0xffffff); 
        sceneRef.current.stringMaterial.opacity = 1.0;

        // Stronger glow for "thickness"
        sceneRef.current.bloomPass.strength = 3.0; 
        sceneRef.current.bloomPass.radius = 1.0; 
    }
  }, [baseColor]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const clearConnections = () => {
      activeConnectionsRef.current = [];
      setConnectionCount(0);
  };

  useEffect(() => {
    let handLandmarker: HandLandmarker | null = null;
    let animationId: number;
    let renderer: THREE.WebGLRenderer;
    let composer: EffectComposer;
    let camera: THREE.PerspectiveCamera;
    
    // --- 1. Three.js Setup ---
    const initThree = () => {
        if (!mountRef.current) return;

        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;

        const scene = new THREE.Scene();
        // Deep space background
        scene.fog = new THREE.FogExp2(0x050505, 0.02);

        camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
        camera.position.z = 5;

        renderer = new THREE.WebGLRenderer({ 
            antialias: false, 
            powerPreference: "high-performance",
            alpha: true 
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mountRef.current.appendChild(renderer.domElement);

        // Bloom for "Glow/Halo" effect - Increased for perceived thickness
        const renderScene = new RenderPass(scene, camera);
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
        bloomPass.strength = 3.0; // High strength for thick glow
        bloomPass.radius = 1.0;   // Wide radius for soft edges
        bloomPass.threshold = 0.1;

        composer = new EffectComposer(renderer);
        composer.addPass(renderScene);
        composer.addPass(bloomPass);

        // --- Geometries ---
        
        // Hand Points (Joints)
        const pointGeo = new THREE.BufferGeometry();
        pointGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
        
        const pointMat = new THREE.PointsMaterial({
            color: colorRef.current,
            size: 0.08, 
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true
        });

        const hand1Points = new THREE.Points(pointGeo.clone(), pointMat);
        const hand2Points = new THREE.Points(pointGeo.clone(), pointMat);
        
        // Skeleton (Internal hand structure)
        const skeletonGeo = new THREE.BufferGeometry();
        skeletonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(100 * 3), 3));
        
        // Fainter hand lines
        const lineMat = new THREE.LineBasicMaterial({
            color: colorRef.current,
            transparent: true,
            opacity: 0.15, // Lower opacity to make strings pop
            blending: THREE.AdditiveBlending
        });

        const hand1Lines = new THREE.LineSegments(skeletonGeo.clone(), lineMat);
        const hand2Lines = new THREE.LineSegments(skeletonGeo.clone(), lineMat);

        // Connector Lines (The "Strings")
        // We allocate 3 lines per connection to simulate thickness via offsets
        const MAX_CONNECTIONS = 5; 
        const LINES_PER_CONNECTION = 3; 
        const connectorGeo = new THREE.BufferGeometry();
        connectorGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CONNECTIONS * LINES_PER_CONNECTION * 2 * 3), 3));
        
        // Bright White String Material
        const stringMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0, 
            blending: THREE.AdditiveBlending,
            linewidth: 3, // WebGL often limits this to 1, so we rely on Bloom + Geometry bundle
        });

        const connectorLines = new THREE.LineSegments(connectorGeo, stringMat);
        connectorLines.frustumCulled = false; // Always render lines

        scene.add(hand1Points);
        scene.add(hand2Points);
        scene.add(hand1Lines);
        scene.add(hand2Lines);
        scene.add(connectorLines);

        sceneRef.current = {
            hand1Points,
            hand2Points,
            hand1Lines,
            hand2Lines,
            connectorLines,
            material: lineMat,
            stringMaterial: stringMat,
            pointMaterial: pointMat,
            bloomPass
        };

        // --- Animation Loop ---
        const clock = new THREE.Clock();
        const LERP_FACTOR = 0.3; // Faster lerp for responsiveness

        // World Scale
        const SCALE_X = 12;
        const SCALE_Y = 9;
        const DEPTH_SCALE = 5;

        // Collision Logic
        const checkCollisions = (h1: any[], h2: any[]) => {
            const TIPS = [4, 8, 12, 16, 20]; // Thumb, Index, Middle, Ring, Pinky
            const COLLISION_THRESHOLD = 0.5; // Slightly easier to connect

            // Get sets of currently connected fingers to enforce 1-to-1
            const connectedHand1Fingers = new Set(activeConnectionsRef.current.map(c => c.p1Idx));
            const connectedHand2Fingers = new Set(activeConnectionsRef.current.map(c => c.p2Idx));

            let newConnectionMade = false;

            TIPS.forEach(tip1 => {
                if (connectedHand1Fingers.has(tip1)) return; // Skip if this finger is busy

                TIPS.forEach(tip2 => {
                    if (connectedHand2Fingers.has(tip2)) return; // Skip if this finger is busy
                    
                    const p1 = h1[tip1]; 
                    const p2 = h2[tip2]; 

                    // Distance Check
                    const dx = ((0.5 - p1.x) * SCALE_X) - ((0.5 - p2.x) * SCALE_X);
                    const dy = ((0.5 - p1.y) * SCALE_Y) - ((0.5 - p2.y) * SCALE_Y);
                    const dz = (-p1.z * DEPTH_SCALE) - (-p2.z * DEPTH_SCALE);
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

                    if (dist < COLLISION_THRESHOLD) {
                        const id = `${tip1}-${tip2}`;
                        activeConnectionsRef.current.push({ id, p1Idx: tip1, p2Idx: tip2 });
                        
                        // Mark as connected for this frame's logic
                        connectedHand1Fingers.add(tip1);
                        connectedHand2Fingers.add(tip2);
                        
                        newConnectionMade = true;
                    }
                });
            });

            if (newConnectionMade) {
                setConnectionCount(activeConnectionsRef.current.length);
            }
        };

        const animate = () => {
            animationId = requestAnimationFrame(animate);
            const time = clock.getElapsedTime();

            if (sceneRef.current) {
                // 1. Data Processing & Smoothing
                const { hand1Target, hand2Target } = landmarksRef.current;
                
                // Init smoothing buffers if first frame
                if (hand1Target && !landmarksRef.current.hand1Current) landmarksRef.current.hand1Current = JSON.parse(JSON.stringify(hand1Target));
                if (hand2Target && !landmarksRef.current.hand2Current) landmarksRef.current.hand2Current = JSON.parse(JSON.stringify(hand2Target));

                // Hand 1 Update
                if (hand1Target && landmarksRef.current.hand1Current) {
                    smoothLandmarks(landmarksRef.current.hand1Current, hand1Target, LERP_FACTOR);
                    updateGeometry(sceneRef.current.hand1Points, sceneRef.current.hand1Lines, landmarksRef.current.hand1Current, SCALE_X, SCALE_Y, DEPTH_SCALE);
                    
                    sceneRef.current.hand1Points.visible = handModel !== 'web';
                    sceneRef.current.hand1Lines.visible = handModel === 'skeleton' || handModel === 'web';
                } else {
                    sceneRef.current.hand1Points.visible = false;
                    sceneRef.current.hand1Lines.visible = false;
                }

                // Hand 2 Update
                if (hand2Target && landmarksRef.current.hand2Current) {
                    smoothLandmarks(landmarksRef.current.hand2Current, hand2Target, LERP_FACTOR);
                    updateGeometry(sceneRef.current.hand2Points, sceneRef.current.hand2Lines, landmarksRef.current.hand2Current, SCALE_X, SCALE_Y, DEPTH_SCALE);
                    
                    sceneRef.current.hand2Points.visible = handModel !== 'web';
                    sceneRef.current.hand2Lines.visible = handModel === 'skeleton' || handModel === 'web';
                } else {
                    sceneRef.current.hand2Points.visible = false;
                    sceneRef.current.hand2Lines.visible = false;
                }

                // 2. String Physics (Collision & Rendering)
                if (hand1Target && hand2Target && landmarksRef.current.hand1Current && landmarksRef.current.hand2Current) {
                    checkCollisions(landmarksRef.current.hand1Current, landmarksRef.current.hand2Current);
                    
                    updateActiveConnectors(
                        sceneRef.current.connectorLines, 
                        landmarksRef.current.hand1Current, 
                        landmarksRef.current.hand2Current,
                        SCALE_X, SCALE_Y, DEPTH_SCALE
                    );
                    sceneRef.current.connectorLines.visible = true;
                } else {
                    // Hide strings if hands are lost, but keep data
                    sceneRef.current.connectorLines.visible = false;
                }

                // 3. Visual Effects
                // Subtle pulsation for the string opacity
                sceneRef.current.stringMaterial.opacity = 0.9 + 0.1 * Math.sin(time * 5);
            }

            composer.render();
        };

        animate();
    };

    // --- 2. MediaPipe Setup ---
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
                numHands: 2
            });

            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.addEventListener("loadeddata", () => {
                        setLoading(false);
                        setStatusText("System Active. Bring hands together.");
                        predictWebcam();
                    });
                }
            }
        } catch (e) {
            console.error(e);
            setStatusText("Error: Camera access required.");
            setLoading(false);
        }
    };

    // --- 3. Geometry Helpers ---
    const smoothLandmarks = (current: any[], target: any[], factor: number) => {
        for (let i = 0; i < current.length; i++) {
            current[i].x = lerp(current[i].x, target[i].x, factor);
            current[i].y = lerp(current[i].y, target[i].y, factor);
            current[i].z = lerp(current[i].z, target[i].z, factor);
        }
    };

    const updateGeometry = (points: THREE.Points, lines: THREE.LineSegments, landmarks: any[], sx: number, sy: number, sz: number) => {
        const posAttr = points.geometry.attributes.position as THREE.BufferAttribute;
        const lineAttr = lines.geometry.attributes.position as THREE.BufferAttribute;
        
        // Update Points
        for (let i = 0; i < landmarks.length; i++) {
            posAttr.setXYZ(i, (0.5 - landmarks[i].x) * sx, (0.5 - landmarks[i].y) * sy, -landmarks[i].z * sz);
        }
        posAttr.needsUpdate = true;

        // Update Skeleton Lines
        const CONNECTIONS = [
            [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8], // Index
            [0, 9], [9, 10], [10, 11], [11, 12], // Middle
            [0, 13], [13, 14], [14, 15], [15, 16], // Ring
            [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
            [5, 9], [9, 13], [13, 17], [0, 17] // Palm
        ];
        
        let lineIdx = 0;
        for (const [start, end] of CONNECTIONS) {
            const s = landmarks[start];
            const e = landmarks[end];
            lineAttr.setXYZ(lineIdx++, (0.5 - s.x) * sx, (0.5 - s.y) * sy, -s.z * sz);
            lineAttr.setXYZ(lineIdx++, (0.5 - e.x) * sx, (0.5 - e.y) * sy, -e.z * sz);
        }
        lineAttr.needsUpdate = true;
    };

    const updateActiveConnectors = (lines: THREE.LineSegments, lm1: any[], lm2: any[], sx: number, sy: number, sz: number) => {
        const lineAttr = lines.geometry.attributes.position as THREE.BufferAttribute;
        let idx = 0;
        
        // Small offset for thickness simulation
        const OFF = 0.02;

        activeConnectionsRef.current.forEach(conn => {
            const p1 = lm1[conn.p1Idx];
            const p2 = lm2[conn.p2Idx];
            
            const x1 = (0.5 - p1.x) * sx;
            const y1 = (0.5 - p1.y) * sy;
            const z1 = -p1.z * sz;
            
            const x2 = (0.5 - p2.x) * sx;
            const y2 = (0.5 - p2.y) * sy;
            const z2 = -p2.z * sz;

            // Main Line
            lineAttr.setXYZ(idx++, x1, y1, z1);
            lineAttr.setXYZ(idx++, x2, y2, z2);

            // Offset Line 1 (Simulate thickness)
            lineAttr.setXYZ(idx++, x1 + OFF, y1 + OFF, z1);
            lineAttr.setXYZ(idx++, x2 + OFF, y2 + OFF, z2);

             // Offset Line 2 (Simulate thickness)
            lineAttr.setXYZ(idx++, x1 - OFF, y1 - OFF, z1);
            lineAttr.setXYZ(idx++, x2 - OFF, y2 - OFF, z2);
        });

        // Zero out remaining
        for (let i = idx; i < lineAttr.count; i++) lineAttr.setXYZ(i, 0, 0, 0);
        
        lineAttr.needsUpdate = true;
        lines.geometry.computeBoundingSphere();
    };

    const predictWebcam = () => {
        if (!handLandmarker || !videoRef.current) return;
        
        // Throttling to ~30 FPS (33ms) to keep Main Thread Smooth for rendering
        const now = performance.now();
        if (now - lastPredictionTimeRef.current < 33) {
             requestAnimationFrame(predictWebcam);
             return;
        }
        lastPredictionTimeRef.current = now;

        if (videoRef.current.currentTime !== lastVideoTimeRef.current && 
            videoRef.current.videoWidth > 0 && 
            !videoRef.current.paused) {
           
           lastVideoTimeRef.current = videoRef.current.currentTime;
           const result = handLandmarker.detectForVideo(videoRef.current, now);
           
           if (result.landmarks.length > 0) {
               landmarksRef.current.hand1Target = result.landmarks[0];
               if (result.landmarks.length > 1) {
                   landmarksRef.current.hand2Target = result.landmarks[1];
               } else {
                   landmarksRef.current.hand2Target = null;
               }
           } else {
               landmarksRef.current.hand1Target = null;
               landmarksRef.current.hand2Target = null;
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
    initThree();
    setupMediaPipe();

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
  }, [handModel]);

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 overflow-hidden font-sans select-none">
       {/* Hidden Video for MediaPipe */}
       <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-1 h-1" autoPlay playsInline muted></video>

       {/* Loading Overlay */}
       {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black/80 backdrop-blur-sm">
                <div className="w-16 h-16 border-4 border-t-blue-400 border-white/10 rounded-full animate-spin mb-6"></div>
                <div className="text-blue-300 tracking-[0.3em] text-sm animate-pulse font-bold">CALIBRATING SENSORS...</div>
            </div>
       )}

       {/* Canvas Container */}
       <div ref={mountRef} className="w-full h-full cursor-crosshair"></div>

       {/* UI: Top Right Controls */}
       <div className="absolute top-6 right-6 flex flex-col gap-4 items-end animate-fade-in z-40">
           
           {/* Color Picker */}
           <div className="group flex items-center gap-3 bg-black/30 backdrop-blur-md border border-white/10 p-2 pl-4 rounded-xl shadow-xl transition-all hover:bg-black/50 hover:border-white/20">
                <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider group-hover:text-gray-200 transition-colors">Core Color</label>
                <div className="relative w-8 h-8 rounded-full overflow-hidden border border-white/20">
                     <input 
                        type="color" 
                        value={baseColor}
                        onChange={(e) => setBaseColor(e.target.value)}
                        className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] p-0 m-0 cursor-pointer border-none"
                    />
                </div>
           </div>

           {/* Hand Model Selector */}
           <div className="bg-black/30 backdrop-blur-md border border-white/10 p-1 rounded-xl flex flex-col gap-1 shadow-xl">
                {(['skeleton', 'joints', 'web'] as HandModel[]).map(mode => (
                    <button
                        key={mode}
                        onClick={() => setHandModel(mode)}
                        className={`px-5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${
                            handModel === mode 
                            ? 'bg-white/90 text-black shadow-lg shadow-white/10 scale-105' 
                            : 'text-gray-400 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        {mode}
                    </button>
                ))}
           </div>

            {/* Actions */}
           <div className="flex gap-2">
               <button 
                    onClick={clearConnections}
                    className="bg-red-500/10 backdrop-blur-md border border-red-500/30 px-4 py-3 rounded-xl text-red-300 hover:bg-red-500/20 hover:text-red-100 transition-all text-[10px] font-bold uppercase tracking-widest shadow-lg flex items-center gap-2"
               >
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                    Cut Strings
               </button>

               <button 
                    onClick={toggleFullscreen}
                    className="bg-black/30 backdrop-blur-md border border-white/10 px-4 py-3 rounded-xl text-white hover:bg-white/20 transition-all shadow-lg"
                    title="Toggle Fullscreen"
               >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        {isFullscreen ? (
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
                        ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                        )}
                    </svg>
               </button>
           </div>
       </div>

       {/* Status HUD */}
       <div className="absolute bottom-10 left-0 w-full text-center pointer-events-none z-30 flex flex-col items-center gap-1">
            <h2 className="text-white/80 text-xl font-light tracking-[0.2em] drop-shadow-md">
                CAT'S CRADLE
            </h2>
            <div className="flex items-center gap-3">
                <div className="h-px w-12 bg-gradient-to-r from-transparent to-white/50"></div>
                <p className="text-blue-300 text-[10px] tracking-[0.3em] uppercase">
                    {activeConnectionsRef.current.length > 0 ? `${connectionCount}/5 Active Links` : "Touch Fingertips to Weave"}
                </p>
                <div className="h-px w-12 bg-gradient-to-l from-transparent to-white/50"></div>
            </div>
       </div>

       {/* Back Button */}
       <button 
          onClick={onBack}
          className="absolute top-6 left-6 group flex items-center gap-3 z-40 bg-black/30 px-5 py-3 rounded-xl backdrop-blur-md border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all"
       >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 group-hover:text-white transition-colors">Exit Simulation</span>
       </button>
    </div>
  );
};

export default ParticleExperience;

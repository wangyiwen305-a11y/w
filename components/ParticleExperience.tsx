
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

type HandModel = 'skeleton' | 'joints' | 'web';

interface Connection {
    id: string;
    p1Idx: number; // Index in Hand 1
    p2Idx: number; // Index in Hand 2
    colorOffset: number;
}

// Helper for linear interpolation
const lerp = (start: number, end: number, factor: number) => start + (end - start) * factor;

const ParticleExperience: React.FC<ParticleExperienceProps> = ({ onBack }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // UI State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseColor, setBaseColor] = useState<string>('#00ffff');
  const [handModel, setHandModel] = useState<HandModel>('joints'); // Default to joints so we see hands first
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [handCount, setHandCount] = useState(0);

  // Connection State
  const activeConnectionsRef = useRef<Connection[]>([]);

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
  } | null>(null);

  const colorRef = useRef(new THREE.Color('#00ffff'));
  const lastVideoTimeRef = useRef(-1);

  useEffect(() => {
    colorRef.current.set(baseColor);
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
        scene.fog = new THREE.FogExp2(0x000000, 0.02);

        camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
        camera.position.z = 5;

        renderer = new THREE.WebGLRenderer({ 
            antialias: false, // Turn off MSAA, let Bloom handle smoothing. Performance win.
            powerPreference: "high-performance",
            alpha: true,
            stencil: false,
            depth: true
        });
        renderer.setSize(width, height);
        // PERFORMANCE: Cap pixel ratio to 1.5. 
        // 2.0 or 3.0 (Retina) with Bloom is too heavy for many GPUs. 1.5 looks great and runs fast.
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); 
        mountRef.current.appendChild(renderer.domElement);

        // Bloom for "Glow/Halo" effect
        const renderScene = new RenderPass(scene, camera);
        
        // Optimizing Bloom: reduced resolution slightly internally if needed, but default is usually fine with ratio cap
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
        bloomPass.strength = 3.0; // Strong glow
        bloomPass.radius = 0.5;
        bloomPass.threshold = 0.1;

        composer = new EffectComposer(renderer);
        composer.addPass(renderScene);
        composer.addPass(bloomPass);

        // --- Geometries ---
        
        // Hand Points (Joints) - Small & Refined
        const pointGeo = new THREE.BufferGeometry();
        pointGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
        
        const pointMat = new THREE.PointsMaterial({
            color: colorRef.current,
            size: 0.04, // Small joints
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true
        });

        const hand1Points = new THREE.Points(pointGeo.clone(), pointMat);
        const hand2Points = new THREE.Points(pointGeo.clone(), pointMat);
        
        // Skeleton (Internal hand structure)
        const skeletonGeo = new THREE.BufferGeometry();
        skeletonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(100 * 3), 3));
        
        const lineMat = new THREE.LineBasicMaterial({
            color: colorRef.current,
            transparent: true,
            opacity: 0.2, 
            blending: THREE.AdditiveBlending
        });

        const hand1Lines = new THREE.LineSegments(skeletonGeo.clone(), lineMat);
        const hand2Lines = new THREE.LineSegments(skeletonGeo.clone(), lineMat);

        // Connector Lines (The "String") - Dynamic Buffer
        // Allocate enough space for connections (5 fingers max)
        const MAX_CONNECTIONS = 10; 
        const connectorGeo = new THREE.BufferGeometry();
        connectorGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CONNECTIONS * 2 * 3), 3));
        
        const stringMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0, 
            blending: THREE.AdditiveBlending,
            // Linewidth is generally 1 on Windows/Chrome, relying on Bloom for "Thickness"
        });

        const connectorLines = new THREE.LineSegments(connectorGeo, stringMat);
        connectorLines.frustumCulled = false;

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
            pointMaterial: pointMat
        };

        // --- Animation Loop ---
        const clock = new THREE.Clock();
        const LERP_FACTOR = 0.35; // PERFORMANCE: Increased slightly for snappier response

        // Scale factors for interaction space
        const SCALE_X = 12;
        const SCALE_Y = 9;
        const DEPTH_SCALE = 5;

        // Collision Logic Helper
        const checkCollisions = (h1: any[], h2: any[]) => {
            const FINGER_PAIRS = [
                { t1: 4, t2: 4 },   // Thumb
                { t1: 8, t2: 8 },   // Index
                { t1: 12, t2: 12 }, // Middle
                { t1: 16, t2: 16 }, // Ring
                { t1: 20, t2: 20 }  // Pinky
            ];
            
            const COLLISION_THRESHOLD = 0.5; // Slightly easier to connect

            FINGER_PAIRS.forEach(({t1, t2}) => {
                const p1 = h1[t1]; 
                const p2 = h2[t2]; 

                // Calculate Distance
                const dx = ((0.5 - p1.x) * SCALE_X) - ((0.5 - p2.x) * SCALE_X);
                const dy = ((0.5 - p1.y) * SCALE_Y) - ((0.5 - p2.y) * SCALE_Y);
                const dz = (-p1.z * DEPTH_SCALE) - (-p2.z * DEPTH_SCALE);
                const distSq = dx*dx + dy*dy + dz*dz; // Use squared distance to avoid sqrt

                if (distSq < COLLISION_THRESHOLD * COLLISION_THRESHOLD) {
                    const id = `${t1}-${t2}`;
                    // Fast check
                    let exists = false;
                    for(let i=0; i<activeConnectionsRef.current.length; i++) {
                        if(activeConnectionsRef.current[i].id === id) {
                            exists = true;
                            break;
                        }
                    }
                    
                    if (!exists) {
                        activeConnectionsRef.current.push({
                            id,
                            p1Idx: t1,
                            p2Idx: t2,
                            colorOffset: Math.random()
                        });
                    }
                }
            });
        };

        const animate = () => {
            animationId = requestAnimationFrame(animate);
            const time = clock.getElapsedTime();

            if (sceneRef.current) {
                // 1. Smooth Interpolation Logic
                const { hand1Target, hand2Target } = landmarksRef.current;
                
                // Initialize current if null
                if (hand1Target && !landmarksRef.current.hand1Current) {
                    landmarksRef.current.hand1Current = JSON.parse(JSON.stringify(hand1Target));
                }
                if (hand2Target && !landmarksRef.current.hand2Current) {
                    landmarksRef.current.hand2Current = JSON.parse(JSON.stringify(hand2Target));
                }

                // Lerp Hand 1
                if (hand1Target && landmarksRef.current.hand1Current) {
                    const current = landmarksRef.current.hand1Current;
                    for (let i = 0; i < 21; i++) {
                        current[i].x += (hand1Target[i].x - current[i].x) * LERP_FACTOR;
                        current[i].y += (hand1Target[i].y - current[i].y) * LERP_FACTOR;
                        current[i].z += (hand1Target[i].z - current[i].z) * LERP_FACTOR;
                    }
                    updateGeometry(sceneRef.current.hand1Points, sceneRef.current.hand1Lines, current, SCALE_X, SCALE_Y, DEPTH_SCALE);
                    sceneRef.current.hand1Points.visible = handModel === 'joints' || handModel === 'skeleton';
                    sceneRef.current.hand1Lines.visible = handModel === 'skeleton' || handModel === 'web';
                } else {
                    sceneRef.current.hand1Points.visible = false;
                    sceneRef.current.hand1Lines.visible = false;
                }

                // Lerp Hand 2
                if (hand2Target && landmarksRef.current.hand2Current) {
                    const current = landmarksRef.current.hand2Current;
                    for (let i = 0; i < 21; i++) {
                        current[i].x += (hand2Target[i].x - current[i].x) * LERP_FACTOR;
                        current[i].y += (hand2Target[i].y - current[i].y) * LERP_FACTOR;
                        current[i].z += (hand2Target[i].z - current[i].z) * LERP_FACTOR;
                    }
                    updateGeometry(sceneRef.current.hand2Points, sceneRef.current.hand2Lines, current, SCALE_X, SCALE_Y, DEPTH_SCALE);
                    sceneRef.current.hand2Points.visible = handModel === 'joints' || handModel === 'skeleton';
                    sceneRef.current.hand2Lines.visible = handModel === 'skeleton' || handModel === 'web';
                } else {
                    sceneRef.current.hand2Points.visible = false;
                    sceneRef.current.hand2Lines.visible = false;
                }

                // COLLISION & CONNECTION UPDATE
                if (hand1Target && hand2Target && landmarksRef.current.hand1Current && landmarksRef.current.hand2Current) {
                    // Check for new collisions
                    checkCollisions(landmarksRef.current.hand1Current, landmarksRef.current.hand2Current);
                    
                    // Render Active Connections
                    updateActiveConnectors(
                        sceneRef.current.connectorLines, 
                        landmarksRef.current.hand1Current, 
                        landmarksRef.current.hand2Current,
                        SCALE_X, SCALE_Y, DEPTH_SCALE
                    );
                    sceneRef.current.connectorLines.visible = true;
                } else {
                    sceneRef.current.connectorLines.visible = false;
                }

                // 2. Visual Effects (Lightning/Pulse)
                const flicker = Math.random() > 0.85 ? 1.4 : 0.9 + Math.sin(time * 15) * 0.1;
                const flash = Math.random() > 0.97;
                const activeColor = flash ? new THREE.Color(0xffffff) : colorRef.current;
                
                sceneRef.current.material.color.copy(activeColor).multiplyScalar(flicker * 0.8);
                
                // Make strings brighter/thicker visually
                const stringColor = activeColor.clone().lerp(new THREE.Color(0xffffff), 0.7);
                sceneRef.current.stringMaterial.color.copy(stringColor).multiplyScalar(flicker * 2.0);
                
                sceneRef.current.pointMaterial.color.copy(activeColor).multiplyScalar(flicker);
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
                        predictWebcam();
                    });
                }
            }
        } catch (e) {
            console.error(e);
            setError("Camera access required.");
            setLoading(false);
        }
    };

    // --- 3. Geometry Logic ---
    const CONNECTIONS = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [0, 9], [9, 10], [10, 11], [11, 12], // Middle
        [0, 13], [13, 14], [14, 15], [15, 16], // Ring
        [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [5, 9], [9, 13], [13, 17] // Palm
    ];

    const updateGeometry = (
        points: THREE.Points, 
        lines: THREE.LineSegments, 
        landmarks: any[], 
        sx: number, sy: number, sz: number
    ) => {
        const posAttr = points.geometry.attributes.position as THREE.BufferAttribute;
        const lineAttr = lines.geometry.attributes.position as THREE.BufferAttribute;
        
        // Update Points
        for (let i = 0; i < 21; i++) {
            const x = (0.5 - landmarks[i].x) * sx;
            const y = (0.5 - landmarks[i].y) * sy;
            const z = -landmarks[i].z * sz; 
            posAttr.setXYZ(i, x, y, z);
        }
        posAttr.needsUpdate = true;

        // Update Skeleton Lines
        let lineIdx = 0;
        for (let i = 0; i < CONNECTIONS.length; i++) {
            const [start, end] = CONNECTIONS[i];
            const startL = landmarks[start];
            const endL = landmarks[end];
            lineAttr.setXYZ(lineIdx++, (0.5 - startL.x) * sx, (0.5 - startL.y) * sy, -startL.z * sz);
            lineAttr.setXYZ(lineIdx++, (0.5 - endL.x) * sx, (0.5 - endL.y) * sy, -endL.z * sz);
        }
        lineAttr.needsUpdate = true;
    };

    const updateActiveConnectors = (
        lines: THREE.LineSegments, 
        landmarks1: any[], 
        landmarks2: any[],
        sx: number, sy: number, sz: number
    ) => {
        const lineAttr = lines.geometry.attributes.position as THREE.BufferAttribute;
        let idx = 0;
        const count = activeConnectionsRef.current.length;

        // Draw ONLY active connections
        for(let i=0; i<count; i++) {
            const conn = activeConnectionsRef.current[i];
            const p1 = landmarks1[conn.p1Idx];
            const p2 = landmarks2[conn.p2Idx];

            lineAttr.setXYZ(idx++, (0.5 - p1.x) * sx, (0.5 - p1.y) * sy, -p1.z * sz);
            lineAttr.setXYZ(idx++, (0.5 - p2.x) * sx, (0.5 - p2.y) * sy, -p2.z * sz);
        }

        // PERFORMANCE: Tell GPU to ONLY draw the vertices we just set.
        // This prevents processing hundreds of unused vertices.
        lines.geometry.setDrawRange(0, idx); 

        lineAttr.needsUpdate = true;
        lines.geometry.computeBoundingSphere(); // Important for camera culling check
    };

    const predictWebcam = () => {
        if (!handLandmarker || !videoRef.current) return;
        
        if (videoRef.current.currentTime !== lastVideoTimeRef.current && 
            videoRef.current.videoWidth > 0 && 
            !videoRef.current.paused) {
           
           lastVideoTimeRef.current = videoRef.current.currentTime;
           const result = handLandmarker.detectForVideo(videoRef.current, performance.now());
           
           setHandCount(result.landmarks.length);

           if (result.landmarks.length > 0) {
               landmarksRef.current.hand1Target = result.landmarks[0];
           } else {
               landmarksRef.current.hand1Target = null;
           }

           if (result.landmarks.length > 1) {
               landmarksRef.current.hand2Target = result.landmarks[1];
           } else {
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
    <div className="fixed inset-0 z-50 bg-black overflow-hidden font-sans select-none">
       {/* Hidden Video for MediaPipe */}
       <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-1 h-1" autoPlay playsInline muted></video>

       {/* Loading Overlay */}
       {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black/90">
                <div className="w-16 h-16 border-4 border-t-blue-500 border-gray-800 rounded-full animate-spin mb-4"></div>
                <div className="text-blue-400 tracking-[0.3em] text-sm animate-pulse">CONNECTING NEURAL INTERFACE...</div>
            </div>
       )}

       {/* Canvas Container */}
       <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing"></div>

       {/* UI Controls */}
       <div className="absolute top-6 right-6 flex flex-col gap-4 items-end animate-fade-in z-40">
           {/* Color Picker */}
           <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-2xl flex items-center gap-3 shadow-2xl">
                <label className="text-xs text-gray-300 font-bold uppercase tracking-wider">Energy Color</label>
                <input 
                    type="color" 
                    value={baseColor}
                    onChange={(e) => setBaseColor(e.target.value)}
                    className="w-8 h-8 rounded-full border-none cursor-pointer bg-transparent"
                />
           </div>

           {/* Hand Model Selector */}
           <div className="bg-black/40 backdrop-blur-md border border-white/10 p-1.5 rounded-xl flex flex-col gap-1 shadow-2xl">
                {(['web', 'skeleton', 'joints'] as HandModel[]).map(mode => (
                    <button
                        key={mode}
                        onClick={() => setHandModel(mode)}
                        className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                            handModel === mode 
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40' 
                            : 'text-gray-400 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        {mode}
                    </button>
                ))}
           </div>

            {/* Clear Button */}
           <button 
                onClick={clearConnections}
                className="bg-red-500/20 backdrop-blur-md border border-red-500/40 p-3 rounded-xl text-red-200 hover:bg-red-500/40 transition-all text-xs font-bold uppercase tracking-wider"
           >
                Cut Strings
           </button>

           {/* Fullscreen */}
           <button 
                onClick={toggleFullscreen}
                className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-xl text-white hover:bg-white/20 transition-all"
                title="Toggle Fullscreen"
           >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                    {isFullscreen ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
                    ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    )}
                </svg>
           </button>
       </div>

       {/* Status Text */}
       <div className="absolute bottom-10 left-0 w-full text-center pointer-events-none z-30">
            <p className="text-blue-200/50 text-xs tracking-[0.4em] uppercase drop-shadow-[0_0_10px_rgba(0,100,255,0.8)]">
                {handCount < 2 ? "Bring both hands into view" : "Touch fingertips together to weave light"}
            </p>
       </div>

       {/* Back Button */}
       <button 
          onClick={onBack}
          className="absolute top-6 left-6 text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 z-40 bg-black/20 px-4 py-2 rounded-full backdrop-blur-sm border border-white/5"
       >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-widest">Exit</span>
       </button>
    </div>
  );
};

export default ParticleExperience;


import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

interface FanExperienceProps {
  onBack: () => void;
}

const FanExperience: React.FC<FanExperienceProps> = ({ onBack }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("INITIALIZING DREAM FIELD...");

  // Shader Uniforms
  const uniformsRef = useRef({
    iTime: { value: 0 },
    iResolution: { value: new THREE.Vector3() },
    uHandOpen: { value: 0.0 }, // 0.0 closed (calm), 1.0 open (turbulent)
    uHandPos: { value: new THREE.Vector2(0, 0) }, // Controls rotation
  });

  useEffect(() => {
    // --- 1. Three.js Init ---
    let animationId: number;
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    
    // Orthographic camera for full-screen shader
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const renderer = new THREE.WebGLRenderer({ 
        antialias: false, 
        powerPreference: "high-performance" 
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    // Initial Resolution
    uniformsRef.current.iResolution.value.set(width, height, 1);

    // --- 2. The "Dream Nebula" Shader ---
    const geometry = new THREE.PlaneGeometry(2, 2);
    
    const material = new THREE.ShaderMaterial({
        uniforms: uniformsRef.current,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float iTime;
            uniform vec3 iResolution;
            uniform float uHandOpen;
            uniform vec2 uHandPos;

            varying vec2 vUv;

            // Rotation matrix
            mat2 m(float a) {
                float c = cos(a), s = sin(a);
                return mat2(c, -s, s, c);
            }

            // Pseudo-random 3D noise
            float hash(float n) { return fract(sin(n) * 753.5453123); }
            
            float noise(in vec3 x) {
                vec3 p = floor(x);
                vec3 f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                float n = p.x + p.y * 157.0 + 113.0 * p.z;
                return mix(mix(mix(hash(n + 0.0), hash(n + 1.0), f.x),
                            mix(hash(n + 157.0), hash(n + 158.0), f.x), f.y),
                        mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                            mix(hash(n + 270.0), hash(n + 271.0), f.x), f.y), f.z);
            }

            // Map function: Defines the shape of the volume
            float map(vec3 p) {
                float t = iTime * 0.4;
                
                // Interaction: Hand rotation
                p.yz *= m(uHandPos.y * 1.2);
                p.xz *= m(uHandPos.x * 1.2);
                
                // Natural flow
                p.xz *= m(t * 0.3); 
                p.xy *= m(t * 0.2);
                
                vec3 q = p * 2.0 + t;
                
                // Ether form formula
                float d = length(p + vec3(sin(t * 0.5))) * log(length(p) + 1.0) 
                          + sin(q.x + sin(q.z + sin(q.y))) * 0.5 - 1.0;
                
                // Turbulence based on hand open
                d += noise(p * 3.2 + t) * (0.05 + uHandOpen * 0.25);
                
                return d;
            }

            // Pastel Palette Function (Low Saturation/Purity)
            // returns a color vector based on a scalar t
            vec3 pastelPalette(float t) {
                // High base brightness (0.65)
                // Low color amplitude (0.35) -> Low saturation
                vec3 a = vec3(0.65, 0.65, 0.65);
                vec3 b = vec3(0.35, 0.35, 0.35); 
                vec3 c = vec3(1.0, 1.0, 1.0);
                vec3 d = vec3(0.00, 0.33, 0.67); // RGB Phase shift
                return a + b * cos(6.28318 * (c * t + d));
            }

            void main() {
                vec2 p = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;
                
                vec3 ro = vec3(0.0, 0.0, 2.8); // Camera slightly further back
                vec3 rd = normalize(vec3(p, -1.0));
                
                float t = 0.0;
                float d = 0.0;
                vec3 col = vec3(0.0); // Accumulate color directly
                
                int steps = 40 + int(uHandOpen * 25.0);

                for(int i = 0; i < 64; i++) {
                    if(i > steps) break;
                    
                    vec3 pos = ro + rd * t;
                    d = map(pos);
                    
                    // Soft accumulation
                    d = max(abs(d), 0.015);
                    float density = exp(-d * 3.2); 
                    
                    // Dynamic coloring based on position and time
                    // Varies spatially to create the "rainbow nebula" effect
                    float colorIndex = length(pos) * 0.3 + iTime * 0.1 + pos.z * 0.2;
                    vec3 tint = pastelPalette(colorIndex);
                    
                    // Interaction: Hand Open makes it brighter and slightly warmer
                    float brightness = 0.045 * (0.8 + uHandOpen * 0.5);
                    
                    col += density * tint * brightness;
                    
                    t += d * 0.55;
                    if(t > 12.0) break;
                }

                // Aesthetic Tone Mapping
                // Soft gamma curve
                col = pow(col, vec3(0.95)); 
                
                // Slight Vignette to focus center
                col *= 1.1 - length(p) * 0.4;
                
                gl_FragColor = vec4(col, 1.0);
            }
        `
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // --- 3. Logic & MediaPipe ---
    let handLandmarker: HandLandmarker | null = null;
    let targetOpen = 0;
    let currentOpen = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    
    // Setup MediaPipe
    const setupVision = async () => {
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
                   setStatus("NEURAL CONNECTION ESTABLISHED");
                   predict();
                });
            }
        }
    };

    let lastTime = -1;
    const predict = () => {
        if (!handLandmarker || !videoRef.current) return;
        if (videoRef.current.currentTime !== lastTime) {
            lastTime = videoRef.current.currentTime;
            const res = handLandmarker.detectForVideo(videoRef.current, performance.now());
            
            if (res.landmarks && res.landmarks.length > 0) {
                const lm = res.landmarks[0];
                
                const width = Math.hypot(lm[4].x - lm[20].x, lm[4].y - lm[20].y);
                const height = Math.hypot(lm[0].x - lm[12].x, lm[0].y - lm[12].y);
                const ratio = width / height;
                
                const openVal = Math.min(1, Math.max(0, (ratio - 0.4) * 2.0));
                targetOpen = openVal;
                
                targetX = (lm[0].x - 0.5) * 2.0; 
                targetY = -(lm[0].y - 0.5) * 2.0; 
                
                setStatus(openVal > 0.6 ? "STATE: TURBULENT" : "STATE: FLOWING");
            } else {
                 targetOpen = 0.2 + Math.sin(Date.now() * 0.002) * 0.2;
            }
        }
        requestAnimationFrame(predict);
    };
    
    setupVision();

    // Render Loop
    const clock = new THREE.Clock();
    const animate = () => {
        animationId = requestAnimationFrame(animate);
        const delta = clock.getDelta();
        
        uniformsRef.current.iTime.value = clock.getElapsedTime();
        
        currentOpen += (targetOpen - currentOpen) * 3.0 * delta;
        currentX += (targetX - currentX) * 2.0 * delta;
        currentY += (targetY - currentY) * 2.0 * delta;

        uniformsRef.current.uHandOpen.value = currentOpen;
        uniformsRef.current.uHandPos.value.set(currentX, currentY);
        
        renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
        if(!mountRef.current) return;
        const w = mountRef.current.clientWidth;
        const h = mountRef.current.clientHeight;
        renderer.setSize(w, h);
        uniformsRef.current.iResolution.value.set(w, h, 1);
    };
    window.addEventListener('resize', handleResize);

    return () => {
        cancelAnimationFrame(animationId);
        window.removeEventListener('resize', handleResize);
        if(mountRef.current && renderer) {
            mountRef.current.removeChild(renderer.domElement);
            renderer.dispose();
        }
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black text-white z-50 overflow-hidden font-sans">
       <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-1 h-1" autoPlay playsInline muted></video>
       
       <div ref={mountRef} className="w-full h-full" />
       
       {loading && (
           <div className="absolute inset-0 flex items-center justify-center bg-black z-50">
               <div className="text-pink-300 font-light tracking-[0.5em] animate-pulse text-xs">
                   DREAMING...
               </div>
           </div>
       )}

       {/* HUD */}
       <div className="absolute bottom-10 w-full text-center pointer-events-none mix-blend-screen">
           <h1 className="text-xl font-light tracking-[0.4em] text-white/80">
               {status}
           </h1>
           <div className="flex justify-center gap-12 mt-4 text-[10px] text-white/50 tracking-widest uppercase">
                <span>Spread Hand: Turbulence</span>
                <span>Move Hand: Perspective</span>
           </div>
       </div>

       <button 
          onClick={onBack}
          className="absolute top-6 left-6 text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 z-40 bg-black/20 px-5 py-2 rounded-full backdrop-blur-sm border border-white/10"
       >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-widest">Back</span>
       </button>
    </div>
  );
};

export default FanExperience;


import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// --- ICONS ---
const Icons = {
    Play: () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>,
    Pause: () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>,
    Next: () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>,
    Upload: () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" /></svg>,
    Settings: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    Minus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" /></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
};

// --- CHAOS GLITCH SHADER V2 (More Dynamic) ---
const ChaosGlitchShader = {
    uniforms: {
        "tDiffuse": { value: null },
        "amount": { value: 0.0 }, 
        "beat": { value: 0.0 },   
        "time": { value: 0.0 },
        "speed": { value: 1.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float amount;
        uniform float beat;
        uniform float time;
        varying vec2 vUv;

        // --- Utils ---
        float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
        
        float noise(vec2 p) {
            vec2 ip = floor(p);
            vec2 u = fract(p);
            u = u*u*(3.0-2.0*u);
            float res = mix(
                mix(rand(ip), rand(ip+vec2(1.0,0.0)), u.x),
                mix(rand(ip+vec2(0.0,1.0)), rand(ip+vec2(1.0,1.0)), u.x), u.y);
            return res*res;
        }

        void main() {
            vec2 p = vUv;
            
            // INTENSITY CONTROL
            float totalGlitch = amount * 0.3 + beat * 0.9; 
            
            // 1. HORIZONTAL SLICE OFFSET (New: Sharp lateral cuts)
            if (beat > 0.6) {
                float slice = step(0.9, sin(p.y * 50.0 + time * 20.0)); // Create bands
                float offset = (rand(vec2(time, floor(p.y * 20.0))) - 0.5) * 0.1 * slice;
                p.x += offset;
            }

            // 2. DATA MOSHING / BLOCK DISPLACEMENT
            float blockScale = 10.0 + floor(rand(vec2(time*0.1)) * 20.0);
            vec2 block = floor(p * blockScale) / blockScale;
            float blockNoise = noise(vec2(block.y + time * 5.0, block.x));
            
            if (totalGlitch > 0.1 && blockNoise > (0.9 - totalGlitch * 0.5)) {
                float shift = (rand(vec2(time, block.y)) - 0.5) * totalGlitch * 0.4;
                p.x += shift;
            }

            // 3. PIXEL SORTING (Melting)
            if (beat > 0.4) {
                float drip = noise(vec2(p.x * 20.0, time)) * beat * 0.15;
                if (rand(vec2(floor(p.x * 10.0), 0.0)) > 0.5) {
                    p.y -= drip;
                }
            }

            // 4. CHROMATIC ABERRATION (RGB Split)
            float rgbOffset = 0.002 + totalGlitch * 0.03; 
            
            // Add a high frequency jitter to RGB on beat
            if (beat > 0.5) rgbOffset += 0.01 * sin(time * 50.0);

            vec4 r = texture2D(tDiffuse, p + vec2(rgbOffset, 0.0));
            vec4 g = texture2D(tDiffuse, p);
            vec4 b = texture2D(tDiffuse, p - vec2(rgbOffset, 0.0));
            
            vec3 col = vec3(r.r, g.g, b.b);

            // 5. COLOR INVERSION FLASH
            // Occasional full invert on massive beats
            if (beat > 0.9 && rand(vec2(time, 1.0)) > 0.9) {
                col = 1.0 - col;
            }

            // 6. DIGITAL NOISE / STATIC
            float staticNoise = rand(p + vec2(time)) * 0.15 * totalGlitch;
            col += staticNoise;
            
            // 7. VIGNETTE
            float vign = length(vUv - 0.5);
            col *= 1.0 - vign * 0.4 * totalGlitch;

            gl_FragColor = vec4(col, 1.0);
        }
    `
};

interface MusicVizProps {
  onBack: () => void;
}

const MusicVizExperience: React.FC<MusicVizProps> = ({ onBack }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // --- STATE ---
  const [loading, setLoading] = useState(true);
  const [visionReady, setVisionReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [playlist, setPlaylist] = useState<File[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  
  // UI Controls
  const [panelVisible, setPanelVisible] = useState(true);
  const [panelMinimized, setPanelMinimized] = useState(false);
  
  // Visual Params
  const [particleSize, setParticleSize] = useState(0.04); 
  const [colorTheme, setColorTheme] = useState('#7A7171'); 
  const [sensitivity, setSensitivity] = useState(2.0);
  const [exposure, setExposure] = useState(0.1); 
  const [activeShape, setActiveShape] = useState('signature');
  
  const [realTime, setRealTime] = useState("");
  const [currentShapeName, setCurrentShapeName] = useState("专属声纹");
  const [statusText, setStatusText] = useState("SYSTEM BOOT SEQUENCE...");

  // --- REFS ---
  const sceneRef = useRef<any>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  
  // Interaction State
  const handRef = useRef({
      rotation: { x: 0, y: 0 },
      zoom: 1.0,
      isRippleGesture: 0.0, // 0 to 1 float
      isDetectingLeft: false,
      isDetectingRight: false
  });

  // --- PARTICLE GENERATION LOGIC ---
  const PARTICLE_COUNT = 35000;
  
  const generateShape = (type: string, seedString?: string): Float32Array => {
      const arr = new Float32Array(PARTICLE_COUNT * 3);
      
      // REDUCED SCALE TO FIT SCREEN
      const SCALE = 1.1; 

      if (type === 'signature' && seedString) {
          const seededRandom = (str: string) => {
            let h = 0x811c9dc5;
            for(let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
            return function() { h = Math.imul(h ^ (h >>> 16), 2246822507); return ((h >>> 0) / 4294967296); }
          };
          const rng = seededRandom(seedString);
          for(let i=0; i<PARTICLE_COUNT; i++) {
              const u = rng() * Math.PI * 2;
              const v = rng() * Math.PI - (Math.PI/2);
              const r = 2.0 + Math.sin(u * 6.0) * Math.cos(v * 5.0) * 0.5 + (rng() - 0.5);
              arr[i*3] = r * Math.cos(v) * Math.cos(u) * SCALE;
              arr[i*3+1] = r * Math.cos(v) * Math.sin(u) * SCALE;
              arr[i*3+2] = r * Math.sin(v) * SCALE;
          }
      } else if (type === 'ripple') {
          const width = 6.0 * SCALE;
          const depth = 6.0 * SCALE;
          const layers = 15;
          const particlesPerLayer = Math.floor(PARTICLE_COUNT / layers);
          for(let i=0; i<PARTICLE_COUNT; i++) {
              const layerIdx = Math.floor(i / particlesPerLayer);
              const t = (i % particlesPerLayer) / particlesPerLayer;
              const x = (t - 0.5) * width;
              const zBase = (layerIdx / layers - 0.5) * depth;
              const y = Math.sin(x * 2.0 + zBase * 4.0) * 0.5;
              arr[i*3] = x + (Math.random()-0.5)*0.1;
              arr[i*3+1] = y + (Math.random()-0.5)*0.1; 
              arr[i*3+2] = zBase + (Math.random()-0.5)*0.1;
          }
      } else if (type === 'lorenz') {
          let x = 0.1, y = 0.1, z = 0.1;
          const b = 0.19, dt = 0.05;
          for(let i=0; i<PARTICLE_COUNT; i++) {
              const dx = Math.sin(y) - b * x;
              const dy = Math.sin(z) - b * y;
              const dz = Math.sin(x) - b * z;
              x += dx * dt; y += dy * dt; z += dz * dt;
              arr[i*3] = (x - 1.5) * SCALE * 0.8;
              arr[i*3+1] = y * SCALE * 0.8;
              arr[i*3+2] = z * SCALE * 0.8;
              if (i % 200 === 0) { x = (Math.random()-0.5)*4; y = (Math.random()-0.5)*4; z = (Math.random()-0.5)*4; }
          }
      } else if (type === 'menger') {
           const side = 3.0 * SCALE; 
           for(let i=0; i<PARTICLE_COUNT; i++) {
               let x = Math.random(), y = Math.random(), z = Math.random();
               for(let j=0; j<3; j++) {
                   if (x > 0.33 && x < 0.66 && y > 0.33 && y < 0.66) { x+=10; break; }
                   if (y > 0.33 && y < 0.66 && z > 0.33 && z < 0.66) { x+=10; break; }
                   if (z > 0.33 && z < 0.66 && x > 0.33 && x < 0.66) { x+=10; break; }
                   x = (x * 3) % 1; y = (y * 3) % 1; z = (z * 3) % 1;
               }
               if (x > 1.0) { x=Math.random()>0.5?0.05:0.95; y=Math.random(); z=Math.random(); x+=(Math.random()-0.5)*0.2; }
               let fx = (x - 0.5) * side;
               let fy = (y - 0.5) * side;
               let fz = (z - 0.5) * side;
               const angle = fy * 0.5;
               arr[i*3] = fx * Math.cos(angle) - fz * Math.sin(angle);
               arr[i*3+1] = fy;
               arr[i*3+2] = fx * Math.sin(angle) + fz * Math.cos(angle);
           }
      } else if (type === 'galaxy') {
          const numPetals = 30; 
          const particlesPerPetal = Math.floor(PARTICLE_COUNT / numPetals);
          const radius = 5.0 * SCALE;
          for(let i=0; i<PARTICLE_COUNT; i++) {
              const petalIdx = Math.floor(i / particlesPerPetal);
              const t = (i % particlesPerPetal) / particlesPerPetal; 
              const angle = (petalIdx / numPetals) * Math.PI * 2;
              const r = t * radius;
              const width = Math.sin(t * Math.PI) * 1.2 * SCALE * t; 
              const wRandom = (Math.random() - 0.5) * width;
              const xLocal = r;
              const yLocal = wRandom;
              const zLocal = (Math.random() - 0.5) * 0.2 * SCALE; 
              arr[i*3] = xLocal * Math.cos(angle) - yLocal * Math.sin(angle);
              arr[i*3+1] = xLocal * Math.sin(angle) + yLocal * Math.cos(angle);
              arr[i*3+2] = zLocal + Math.sin(angle * 3.0) * 0.5;
          }
      } else if (type === 'strobe') {
          const slices = 64; 
          const particlesPerSlice = Math.floor(PARTICLE_COUNT / slices);
          const rBase = 0.5 * SCALE;
          for(let i=0; i<PARTICLE_COUNT; i++) {
              const sliceIdx = Math.floor(i / particlesPerSlice);
              const progress = sliceIdx / slices; 
              const angle = progress * Math.PI * 2.0; 
              const r = rBase + progress * 2.5 * SCALE;
              const u = Math.random(); const v = Math.random();
              const bladeLen = 1.2 * SCALE * u;
              const bladeWidth = 0.3 * SCALE * (1 - u);
              const xL = bladeLen;
              const yL = (v - 0.5) * bladeWidth;
              const tilt = angle + Math.PI/2;
              arr[i*3] = r * Math.cos(angle) + (xL * Math.cos(tilt) - yL * Math.sin(tilt));
              arr[i*3+1] = r * Math.sin(angle) + (xL * Math.sin(tilt) + yL * Math.cos(tilt));
              arr[i*3+2] = (Math.random() - 0.5) * 0.05; 
          }
      }
      return arr;
  };

  const shapes = useMemo(() => ({
      sphere: generateShape('signature', 'init'),
      lorenz: generateShape('lorenz'),
      galaxy: generateShape('galaxy'),
      menger: generateShape('menger'),
      ripple: generateShape('ripple'),
      strobe: generateShape('strobe')
  }), []);

  // --- HELPER: Create Thick Wireframe Box ---
  const createThickBox = (size: number, thickness: number, color: number) => {
      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshBasicMaterial({ color: color });
      const half = size / 2;
      const addBeam = (x: number, y: number, z: number, sX: number, sY: number, sZ: number) => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(x, y, z);
          mesh.scale.set(sX, sY, sZ);
          group.add(mesh);
      };
      // 12 edges
      addBeam(half, 0, half, thickness, size, thickness);
      addBeam(half, 0, -half, thickness, size, thickness);
      addBeam(-half, 0, half, thickness, size, thickness);
      addBeam(-half, 0, -half, thickness, size, thickness);
      addBeam(0, half, half, size, thickness, thickness);
      addBeam(0, half, -half, size, thickness, thickness);
      addBeam(half, half, 0, thickness, thickness, size);
      addBeam(-half, half, 0, thickness, thickness, size);
      addBeam(0, -half, half, size, thickness, thickness);
      addBeam(0, -half, -half, size, thickness, thickness);
      addBeam(half, -half, 0, thickness, thickness, size);
      addBeam(-half, -half, 0, thickness, thickness, size);
      return group;
  };

  // --- INIT THREE.JS ---
  useEffect(() => {
    const timer = setInterval(() => {
        const d = new Date();
        setRealTime(`${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`);
    }, 1000);

    if (!mountRef.current) return;
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.05);

    const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 100);
    // MOVED CAMERA BACK TO FIT WHOLE SHAPE
    camera.position.z = 9;

    const renderer = new THREE.WebGLRenderer({ 
        antialias: false, 
        alpha: true, 
        powerPreference: "high-performance",
        stencil: false
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    // --- GEOMETRY ---
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const targetPositions = new Float32Array(PARTICLE_COUNT * 3);
    
    positions.set(shapes.sphere);
    targetPositions.set(shapes.sphere);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    // Wireframe Box
    const boxSize = 2.5 * 1.6; 
    const boxThickness = 0.05; 
    const wireframeBox = createThickBox(boxSize, boxThickness, 0xff0000); 
    wireframeBox.visible = false; 
    scene.add(wireframeBox);

    // --- PARTICLE SHADER MATERIAL ---
    const material = new THREE.ShaderMaterial({
        uniforms: {
            color: { value: new THREE.Color(colorTheme) },
            size: { value: particleSize },
            time: { value: 0 },
            beat: { value: 0.0 }, 
            distortion: { value: 0.0 },
            isRipple: { value: 0.0 },
            gestureIntensity: { value: 0.0 }
        },
        vertexShader: `
            uniform float size;
            uniform float time;
            uniform float beat;
            uniform float distortion;
            uniform float isRipple;
            uniform float gestureIntensity;
            varying float vDist;
            
            float rand(vec3 co){ return fract(sin(dot(co.xyz ,vec3(12.9898,78.233,45.543))) * 43758.5453); }

            void main() {
                vec3 pos = position;
                
                // 1. RHYTHM UNDULATION (For Ripple Shape)
                if (isRipple > 0.5) {
                    float wave = sin(pos.x * 2.0 + pos.z * 1.5 + time * 2.0);
                    pos.y += wave * beat * 0.8; 
                } 
                // 2. STANDARD BEAT DISTORTION
                else if (beat > 0.1) {
                    float n = rand(pos + time);
                    pos += normal * beat * n * 0.4; 
                }
                
                // 3. PHYSICAL GLITCH (Quantum Jitter)
                // Randomly offset particles horizontally on strong beats
                if (beat > 0.5) {
                    float jitter = sin(pos.y * 50.0 + time * 40.0) * 0.1 * beat;
                    pos.x += jitter;
                }

                // 4. HAND GESTURE RIPPLE (Pinch Interaction)
                if (gestureIntensity > 0.0) {
                    float jitter = sin(pos.y * 50.0 + time * 30.0) * cos(pos.x * 50.0);
                    pos += normal * jitter * gestureIntensity * 0.4;
                }

                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                
                vDist = length(pos);
                
                // Size attenuation
                gl_PointSize = size * (1.0 + beat * 2.5) * (300.0 / -mvPosition.z);
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            varying float vDist;
            
            void main() {
                vec2 center = gl_PointCoord - 0.5;
                if (length(center) > 0.5) discard;
                
                vec3 finalColor = color;
                // Fade distant particles
                float alpha = 1.0 - smoothstep(1.0, 12.0, vDist); 
                float core = 1.0 - length(center) * 1.5;
                alpha *= clamp(core + 0.3, 0.0, 1.0);

                gl_FragColor = vec4(finalColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    // --- POST PROCESSING (CHAOS GLITCH) ---
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Bloom: Enhance glow
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
    bloomPass.strength = exposure; 
    bloomPass.radius = 0.2; 
    bloomPass.threshold = 0.25; 
    composer.addPass(bloomPass);

    // Glitch: The new intense shader
    const glitchPass = new ShaderPass(ChaosGlitchShader);
    composer.addPass(glitchPass);

    sceneRef.current = { 
        scene, camera, renderer, particles, material, composer, glitchPass, 
        targetPositions, geometry, bloomPass, wireframeBox 
    };
    setLoading(false);

    // Animation Loop
    const clock = new THREE.Clock();
    let animationId: number;

    const animate = () => {
        animationId = requestAnimationFrame(animate);
        const delta = clock.getDelta();
        const time = clock.getElapsedTime();

        // 1. Audio Analysis
        let bass = 0;
        if (analyserRef.current && dataArrayRef.current) {
            analyserRef.current.getByteFrequencyData(dataArrayRef.current);
            const bL = Math.floor(dataArrayRef.current.length * 0.1); 
            for(let i=0; i<bL; i++) bass += dataArrayRef.current[i];
            bass /= bL;
        }
        const nBass = bass / 255; 
        
        // 2. Interaction (Apply Hand Gestures)
        // INCREASED SENSITIVITY: Faster lerp (0.2 instead of 0.1)
        particles.rotation.y += (handRef.current.rotation.y - particles.rotation.y) * 0.2;
        particles.rotation.x += (handRef.current.rotation.x - particles.rotation.x) * 0.2;
        
        const currentScale = particles.scale.x;
        const newScale = currentScale + (handRef.current.zoom - currentScale) * 0.2;
        particles.scale.set(newScale, newScale, newScale);
        wireframeBox.scale.set(newScale, newScale, newScale);
        
        if (wireframeBox.visible) wireframeBox.rotation.copy(particles.rotation);

        // Idle rotation
        if (!handRef.current.isDetectingRight) {
            particles.rotation.z += 0.0005;
        }

        // 3. Update Particle Uniforms
        const isBeat = nBass > 0.5;
        material.uniforms.time.value = time;
        material.uniforms.beat.value = nBass * sensitivity; 
        material.uniforms.distortion.value = isBeat ? nBass : 0.0;
        material.uniforms.gestureIntensity.value = THREE.MathUtils.lerp(
            material.uniforms.gestureIntensity.value, 
            handRef.current.isRippleGesture, 
            0.2
        );

        // 4. Update GLITCH Uniforms (Intense & Reactive)
        // Pass audio beat directly to glitch shader for sync
        glitchPass.uniforms.beat.value = nBass; 
        
        // Base glitch amount + Hand Ripple Influence
        let targetGlitch = isBeat ? nBass * 0.8 : 0.0; 
        targetGlitch += handRef.current.isRippleGesture * 0.8; // Hand gesture adds heavy glitch
        
        glitchPass.uniforms.amount.value = THREE.MathUtils.lerp(glitchPass.uniforms.amount.value, targetGlitch, 0.3);
        glitchPass.uniforms.time.value = time;
        
        const targetStrength = exposure + (isBeat ? nBass * 0.5 : 0);
        bloomPass.strength = THREE.MathUtils.lerp(bloomPass.strength, targetStrength, 0.1);

        // 5. Morphing
        const currentPositions = geometry.attributes.position.array as Float32Array;
        const targets = sceneRef.current.targetPositions;
        const morphSpeed = 3.0 * delta;

        for(let i=0; i < PARTICLE_COUNT * 3; i++) {
            currentPositions[i] += (targets[i] - currentPositions[i]) * morphSpeed;
        }
        geometry.attributes.position.needsUpdate = true;

        composer.render();
    };
    animate();

    const handleResize = () => {
        if (!mountRef.current) return;
        const w = mountRef.current.clientWidth;
        const h = mountRef.current.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
        clearInterval(timer);
        cancelAnimationFrame(animationId);
        window.removeEventListener('resize', handleResize);
        if (mountRef.current && renderer) mountRef.current.removeChild(renderer.domElement);
        if (audioContextRef.current) audioContextRef.current.close();
        if (videoRef.current && videoRef.current.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        }
    };
  }, []);

  // --- HAND TRACKING SETUP (Preserved & Functional) ---
  useEffect(() => {
      let handLandmarker: HandLandmarker | null = null;
      let lastVideoTime = -1;
      let animationFrameId: number;

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
                          setVisionReady(true);
                          setStatusText("HAND TRACKING ACTIVE (L:ZOOM R:ROTATE/FX)");
                          predict();
                      });
                  }
              }
          } catch (e) {
              console.error(e);
              setStatusText("CAMERA ACCESS FAILED");
          }
      };

      const predict = () => {
          if (!handLandmarker || !videoRef.current) return;
          if (videoRef.current.currentTime !== lastVideoTime && !videoRef.current.paused) {
              lastVideoTime = videoRef.current.currentTime;
              const result = handLandmarker.detectForVideo(videoRef.current, performance.now());
              
              let foundLeft = false;
              let foundRight = false;

              if (result.landmarks && result.landmarks.length > 0) {
                  for(let i=0; i<result.landmarks.length; i++) {
                      const landmarks = result.landmarks[i];
                      const handedness = result.handedness[i][0].categoryName;
                      
                      // LEFT HAND: Zoom
                      if (handedness === "Left") {
                          foundLeft = true;
                          const p1 = landmarks[4]; // Thumb Tip
                          const p2 = landmarks[8]; // Index Tip
                          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                          const normalized = Math.min(Math.max((dist - 0.02) / 0.25, 0), 1);
                          
                          // UPDATED ZOOM RANGE: 0.4 (min) to 3.5 (max) - Better visibility
                          const minScale = 0.4;
                          const maxScale = 3.5;
                          handRef.current.zoom = minScale + normalized * (maxScale - minScale);
                      } 
                      
                      // RIGHT HAND: Rotation & Ripple
                      if (handedness === "Right") {
                          foundRight = true;
                          const indexTip = landmarks[8];
                          const middleTip = landmarks[12];
                          
                          // Rotation (INCREASED SENSITIVITY from 8.0 to 15.0)
                          handRef.current.rotation.y = (indexTip.x - 0.5) * 15.0; 
                          handRef.current.rotation.x = (indexTip.y - 0.5) * 15.0; 
                          
                          // Ripple (Pinch) - Eased threshold from 0.05 to 0.08
                          const fingersDist = Math.hypot(indexTip.x - middleTip.x, indexTip.y - middleTip.y);
                          handRef.current.isRippleGesture = (fingersDist < 0.08) ? 1.0 : 0.0;
                      }
                  }
              }
              
              handRef.current.isDetectingLeft = foundLeft;
              handRef.current.isDetectingRight = foundRight;
          }
          animationFrameId = requestAnimationFrame(predict);
      };
      setupMediaPipe();
      return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // --- HANDLERS ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          const newFiles = Array.from(e.target.files);
          setPlaylist(prev => [...prev, ...newFiles]);
          if (playlist.length === 0) loadSong(newFiles[0], 0);
      }
  };

  const loadSong = (file: File, index: number) => {
      setCurrentSongIndex(index);
      const url = URL.createObjectURL(file);
      if (!audioContextRef.current) {
         const Ctx = window.AudioContext || (window as any).webkitAudioContext;
         audioContextRef.current = new Ctx();
         analyserRef.current = audioContextRef.current.createAnalyser();
         analyserRef.current.fftSize = 2048;
         dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
      }
      if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.play().then(() => {
              setIsPlaying(true);
              if (sceneRef.current.targetPositions) {
                  const sig = generateShape('signature', file.name);
                  sceneRef.current.targetPositions.set(sig);
                  setCurrentShapeName("专属声纹");
                  setActiveShape('signature');
                  if (sceneRef.current.wireframeBox) sceneRef.current.wireframeBox.visible = false;
                  if (sceneRef.current.material) sceneRef.current.material.uniforms.isRipple.value = 0.0;
              }
          }).catch(e => console.error(e));
          try {
             if (audioContextRef.current && analyserRef.current) {
                 const source = audioContextRef.current.createMediaElementSource(audioRef.current);
                 source.connect(analyserRef.current);
                 analyserRef.current.connect(audioContextRef.current.destination);
             }
          } catch(e) {}
      }
  };

  const changeShape = (shapeKey: string) => {
      if (!sceneRef.current.targetPositions) return;
      setActiveShape(shapeKey);
      
      if (sceneRef.current.wireframeBox) {
          sceneRef.current.wireframeBox.visible = (shapeKey === 'menger');
      }
      if (sceneRef.current.material) {
          sceneRef.current.material.uniforms.isRipple.value = (shapeKey === 'ripple') ? 1.0 : 0.0;
      }

      let name = "";
      if (shapeKey === 'signature' && playlist[currentSongIndex]) {
          sceneRef.current.targetPositions.set(generateShape('signature', playlist[currentSongIndex].name));
          name = "专属声纹";
      } else if (shapes[shapeKey as keyof typeof shapes]) {
          sceneRef.current.targetPositions.set(generateShape(shapeKey));
          switch(shapeKey) {
              case 'lorenz': name = "Thomas Attractor (Complex)"; break;
              case 'galaxy': name = "时空光轮 (Chronos)"; break;
              case 'strobe': name = "时空残影 (Strobe)"; break;
              case 'menger': name = "Menger Cage (Squeezed)"; break;
              case 'penrose': name = "彭罗斯三角"; break;
              case 'ripple': name = "Sonic Ripple (Wave)"; break;
              default: name = "未知结构";
          }
      }
      setCurrentShapeName(name);
  };

  useEffect(() => {
      if (sceneRef.current.material) {
          sceneRef.current.material.uniforms.color.value.set(colorTheme);
          sceneRef.current.material.uniforms.size.value = particleSize;
      }
      if (exposure !== sceneRef.current.bloomPass?.strength && !isPlaying) {
          if(sceneRef.current.bloomPass) sceneRef.current.bloomPass.strength = exposure;
      }
  }, [colorTheme, particleSize, exposure, isPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  return (
    <div className="fixed inset-0 bg-[#020202] text-white font-sans overflow-hidden select-none">
        
        {/* WEBCAM FEED (Bottom Right) */}
        <div className="absolute bottom-6 right-6 z-30 flex flex-col items-end pointer-events-none">
            <video 
                ref={videoRef} 
                className="w-32 md:w-40 h-auto rounded-sm border border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.1)] grayscale contrast-125 brightness-110 opacity-90"
                autoPlay 
                playsInline 
                muted
                style={{ transform: 'scaleX(-1)' }}
            ></video>
            <div className="text-[9px] text-white/30 mt-1 tracking-widest uppercase">Input Feed</div>
        </div>

        {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black z-50">
                <div className="text-gray-600 font-bold tracking-[0.5em] animate-pulse text-xs uppercase">
                    INITIALIZING CORE...
                </div>
            </div>
        )}

        <audio 
            ref={audioRef} 
            crossOrigin="anonymous"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onDurationChange={(e) => setDuration(e.currentTarget.duration)}
            onEnded={() => {
                if(currentSongIndex < playlist.length - 1) loadSong(playlist[currentSongIndex+1], currentSongIndex+1);
            }}
        />

        <div ref={mountRef} className="absolute inset-0 z-0 bg-black" />

        {/* --- UI LAYER --- */}
        <div className="absolute top-6 left-6 z-20 w-80 bg-black/60 backdrop-blur-xl border border-white/5 p-4 rounded-sm shadow-2xl">
             <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
                 <h2 className="text-[10px] text-gray-500 tracking-[0.2em] font-bold uppercase">Audio Feed</h2>
                 <label className="cursor-pointer text-white/30 hover:text-white transition-colors" title="Upload">
                     <Icons.Upload />
                     <input type="file" multiple accept="audio/*" className="hidden" onChange={handleFileUpload} />
                 </label>
             </div>
             
             <div className="mb-3 overflow-hidden">
                 <div className="text-xs font-bold truncate text-gray-300">
                     {playlist[currentSongIndex]?.name || "NO SIGNAL"}
                 </div>
                 <div className="text-[9px] text-white/20 mt-1 uppercase tracking-wider flex justify-between">
                     <span>{currentShapeName}</span>
                     <span className={isPlaying ? "text-green-500/50" : "text-red-500/50"}>
                         {isPlaying ? "LIVE" : "PAUSED"}
                     </span>
                 </div>
             </div>

             <div className="group w-full h-px bg-white/10 mb-4 cursor-pointer relative"
                  onClick={(e) => {
                      if(!audioRef.current || duration === 0) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      audioRef.current.currentTime = (x / rect.width) * duration;
                  }}>
                 <div 
                    className="h-full bg-white relative" 
                    style={{ width: `${(currentTime/duration)*100 || 0}%` }}
                 />
             </div>

             <div className="flex items-center justify-between">
                 <div className="flex gap-4 text-gray-500">
                    <button onClick={() => {
                        if(audioRef.current) {
                            if(isPlaying) audioRef.current.pause();
                            else audioRef.current.play();
                            setIsPlaying(!isPlaying);
                        }
                    }} className="hover:text-white transition-colors">
                        {isPlaying ? <Icons.Pause /> : <Icons.Play />}
                    </button>
                    <button onClick={() => {
                        if(currentSongIndex < playlist.length - 1) loadSong(playlist[currentSongIndex+1], currentSongIndex+1);
                    }} className="hover:text-white transition-colors">
                        <Icons.Next />
                    </button>
                 </div>
                 
                 <div className="flex items-center gap-2 w-24 group">
                    <span className="text-[8px] text-white/30 group-hover:text-white/60">VOL</span>
                    <input 
                        type="range" min="0" max="1" step="0.01" 
                        value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))}
                        className="w-full h-0.5 bg-white/10 appearance-none cursor-pointer accent-white"
                    />
                 </div>
             </div>
        </div>

        <div className="absolute top-6 right-6 z-20 flex flex-col items-end gap-2">
             <div className="flex gap-2">
                <button 
                    onClick={() => setPanelVisible(!panelVisible)}
                    className={`p-3 rounded-sm border border-white/5 backdrop-blur-md transition-all ${panelVisible ? 'bg-white/5 text-white' : 'text-white/30 bg-black/20'}`}
                >
                    <Icons.Settings />
                </button>
                <button onClick={onBack} className="px-4 py-2 text-[10px] font-bold border border-white/5 text-white/40 rounded-sm backdrop-blur-md hover:bg-white/5 bg-black/20 uppercase tracking-widest">
                    Exit
                </button>
             </div>

             {panelVisible && (
                <div className={`transition-all duration-300 ease-in-out bg-black/80 backdrop-blur-xl border border-white/5 rounded-sm shadow-2xl overflow-hidden ${panelMinimized ? 'w-12 h-12' : 'w-72 p-5'}`}>
                    {panelMinimized ? (
                        <button onClick={() => setPanelMinimized(false)} className="w-full h-full flex items-center justify-center text-white/30 hover:bg-white/5">
                            <Icons.Plus />
                        </button>
                    ) : (
                        <div className="flex flex-col gap-5">
                            <div className="flex justify-between items-center border-b border-white/5 pb-2">
                                <h3 className="text-[10px] text-gray-500 tracking-[0.2em] font-bold">VISUAL CORE</h3>
                                <button onClick={() => setPanelMinimized(true)} className="text-white/30 hover:text-white">
                                    <Icons.Minus />
                                </button>
                            </div>
                            
                            <div>
                                <div className="text-[9px] uppercase text-white/30 mb-2 font-bold tracking-widest">模式 (Mode)</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        {k:'signature',l:'声纹 (Sig)'}, 
                                        {k:'ripple',l:'波纹 (Ripple)'}, 
                                        {k:'lorenz',l:'吸引子 (Thomas)'}, 
                                        {k:'menger',l:'牢笼 (Cage)'}, 
                                        {k:'galaxy',l:'光轮 (Chronos)'}, 
                                        {k:'strobe',l:'时空残影 (Strobe)'},
                                        {k:'penrose',l:'彭罗斯 (Penrose)'}
                                    ].map(s => (
                                        <button 
                                            key={s.k} 
                                            onClick={() => changeShape(s.k)}
                                            className={`px-2 py-2 text-[9px] uppercase border transition-all rounded-sm ${
                                                activeShape === s.k 
                                                ? 'bg-white/10 border-white/20 text-white shadow-[0_0_10px_rgba(255,255,255,0.05)]' 
                                                : 'border-white/5 bg-white/0 text-white/30 hover:bg-white/5'
                                            }`}
                                        >
                                            {s.l}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[9px] uppercase text-white/30">
                                        <span>粒子频率 (Sensitivity)</span>
                                        <span className="text-white/60">{sensitivity.toFixed(1)}</span>
                                    </div>
                                    <input type="range" min="0" max="4.0" step="0.1" value={sensitivity} onChange={e => setSensitivity(parseFloat(e.target.value))} className="w-full h-0.5 bg-white/10 appearance-none cursor-pointer accent-white" />
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-[9px] uppercase text-white/30">
                                        <span>曝光度 (Exposure)</span>
                                        <span className="text-white/60">{exposure.toFixed(2)}</span>
                                    </div>
                                    <input type="range" min="0.05" max="1.5" step="0.05" value={exposure} onChange={e => setExposure(parseFloat(e.target.value))} className="w-full h-0.5 bg-white/10 appearance-none cursor-pointer accent-white" />
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-[9px] uppercase text-white/30">
                                        <span>粒子大小 (Size)</span>
                                        <span className="text-white/60">{particleSize.toFixed(2)}</span>
                                    </div>
                                    <input type="range" min="0.01" max="0.2" step="0.01" value={particleSize} onChange={e => setParticleSize(parseFloat(e.target.value))} className="w-full h-0.5 bg-white/10 appearance-none cursor-pointer accent-white" />
                                </div>
                            </div>

                            <div>
                                <div className="text-[9px] uppercase text-white/30 mb-2">主题颜色 (Theme)</div>
                                <div className="flex gap-2 items-center">
                                    {['#7A7171', '#ffffff', '#ff0000', '#00ffcc'].map(c => (
                                        <button 
                                            key={c}
                                            style={{backgroundColor: c, boxShadow: colorTheme === c ? `0 0 5px ${c}40` : 'none'}} 
                                            onClick={() => setColorTheme(c)}
                                            className={`w-4 h-4 rounded-sm border border-white/10 hover:scale-110 transition-all ${colorTheme === c ? 'ring-1 ring-white/50' : 'opacity-60 hover:opacity-100'}`}
                                        />
                                    ))}
                                    <input type="color" value={colorTheme} onChange={e => setColorTheme(e.target.value)} className="w-5 h-5 bg-transparent border-0 p-0 cursor-pointer opacity-50 hover:opacity-100" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
             )}
        </div>

        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none">
            <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase transparent bg-clip-text animate-pulse"
                style={{ 
                    backgroundImage: `linear-gradient(90deg, #222, ${isPlaying ? colorTheme : '#444'}, #222)`,
                    backgroundSize: '200% auto',
                    animation: 'textShine 6s linear infinite',
                    textShadow: isPlaying ? `0 0 10px ${colorTheme}10` : 'none'
                }}
            >
                The Rhythm Beats
            </h1>
            <style>{`
                @keyframes textShine {
                    to { background-position: 200% center; }
                }
            `}</style>
        </div>

        <div className="absolute bottom-8 left-8 z-10 font-mono text-[10px] text-white/20 tracking-widest">
            <div className="text-xl text-white/60 font-bold mb-1">{realTime}</div>
            <div className="flex items-center gap-2">
                <div className={`w-1 h-1 rounded-full ${visionReady ? 'bg-green-500/50' : 'bg-yellow-600/50 animate-pulse'}`} />
                <span>{statusText}</span>
            </div>
        </div>

        <div className="absolute inset-0 pointer-events-none z-30 opacity-5 mix-blend-overlay" 
             style={{ 
                 background: 'repeating-linear-gradient(0deg, transparent, transparent 1px, #000 1px, #000 2px)',
                 backgroundSize: '100% 3px'
             }}
        />
        
    </div>
  );
};

export default MusicVizExperience;

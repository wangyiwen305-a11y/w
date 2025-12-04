
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState } from 'react';
import p5 from 'p5';
import { FilesetResolver, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';

interface ParticleExperienceProps {
  onBack: () => void;
}

const ParticleExperience: React.FC<ParticleExperienceProps> = ({ onBack }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const p5InstanceRef = useRef<p5 | null>(null);
  
  // State for UI controls
  const [handStyle, setHandStyle] = useState<'cyber' | 'skeleton' | 'stardust'>('cyber');
  const [color, setColor] = useState('#00ffff');
  const [loading, setLoading] = useState(true);
  const [handDetected, setHandDetected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Refs to pass state to p5 loop without re-instantiation
  const stateRef = useRef({
      handStyle: 'cyber',
      color: '#00ffff'
  });

  // Keep stateRef synced with React state
  useEffect(() => {
      stateRef.current.handStyle = handStyle;
      stateRef.current.color = color;
  }, [handStyle, color]);

  // Raw Landmarks Data Ref (Shared between MediaPipe and p5)
  // We store the full result to handle multi-hand logic
  const landmarksRef = useRef<HandLandmarkerResult | null>(null);

  useEffect(() => {
    let handLandmarker: HandLandmarker | null = null;
    let requestAnimId: number;

    // --- MediaPipe Setup ---
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
          numHands: 2 // Enable Dual Hand Tracking
        });
        
        // Start Webcam
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 1280, height: 720 } 
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.addEventListener("loadeddata", () => {
                    setLoading(false);
                    predictWebcam();
                });
            }
        }
      } catch (err) {
        console.error("Error setting up MediaPipe:", err);
        setLoading(false);
      }
    };

    const predictWebcam = () => {
        if (!handLandmarker || !videoRef.current) return;
        
        const startTimeMs = performance.now();
        if (videoRef.current.videoWidth > 0) {
            const result = handLandmarker.detectForVideo(videoRef.current, startTimeMs);
            
            if (result.landmarks && result.landmarks.length > 0) {
                setHandDetected(true);
                landmarksRef.current = result;
            } else {
                setHandDetected(false);
                landmarksRef.current = null;
            }
        }
        requestAnimId = requestAnimationFrame(predictWebcam);
    };

    // --- p5.js Sketch Setup ---
    const Sketch = (p: p5) => {
        
        // Finger connections (pairs of indices)
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8], // Index
            [0, 9], [9, 10], [10, 11], [11, 12], // Middle
            [0, 13], [13, 14], [14, 15], [15, 16], // Ring
            [0, 17], [17, 18], [18, 19], [19, 20] // Pinky
        ];

        // Tips indices
        const tips = [4, 8, 12, 16, 20];

        p.setup = () => {
            if (mountRef.current) {
                p.createCanvas(mountRef.current.clientWidth, mountRef.current.clientHeight, p.WEBGL);
            }
            p.setAttributes('alpha', true);
            // p.blendMode(p.ADD); // Additive blending for glow effect
        };

        const drawGlowLine = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, c: p5.Color, weight: number) => {
            // Inner core (White/Bright)
            p.stroke(255, 255, 255, 200);
            p.strokeWeight(weight);
            p.line(x1, y1, z1, x2, y2, z2);

            // Outer Glow (Color)
            p.stroke(c);
            p.strokeWeight(weight * 3);
            p.line(x1, y1, z1, x2, y2, z2);
            
            // Faint Halo
            c.setAlpha(50);
            p.stroke(c);
            p.strokeWeight(weight * 6);
            p.line(x1, y1, z1, x2, y2, z2);
        };

        const drawParticle = (x: number, y: number, z: number, c: p5.Color) => {
             p.push();
             p.translate(x, y, z);
             p.noStroke();
             p.fill(c);
             // Jitter effect for lightning style
             if (p.random(1) > 0.9) {
                 p.fill(255);
                 p.sphere(6);
             } else {
                 p.sphere(3);
             }
             p.pop();
        };

        p.draw = () => {
            p.clear();
            p.background(0, 0, 0, 0); // Transparent background

            const result = landmarksRef.current;
            if (!result || !result.landmarks) return;

            const baseColor = p.color(stateRef.current.color);
            // Add lightning flicker to the base color
            if (p.random(1) > 0.95) {
                baseColor.setAlpha(255);
            } else {
                baseColor.setAlpha(150);
            }

            const scale = Math.min(p.width, p.height);

            // Center camera somewhat
            p.camera(0, 0, scale * 1.2, 0, 0, 0, 0, 1, 0);

            // Process each hand
            const hands = result.landmarks.map((landmarks) => {
                return landmarks.map(lm => ({
                    x: (lm.x - 0.5) * -p.width, // Flip X for mirror effect
                    y: (lm.y - 0.5) * p.height, // Invert Y because p5 y-down
                    z: lm.z * -scale // Depth
                }));
            });

            // 1. Draw Individual Hands
            hands.forEach((handPoints) => {
                const style = stateRef.current.handStyle;

                // Draw Skeleton Lines
                if (style !== 'stardust') {
                    p.stroke(stateRef.current.color);
                    p.strokeWeight(1);
                    p.noFill();
                    
                    connections.forEach(([start, end]) => {
                        const s = handPoints[start];
                        const e = handPoints[end];
                        p.line(s.x, s.y, s.z, e.x, e.y, e.z);
                    });
                }

                // Draw Joints/Particles
                handPoints.forEach((pt, index) => {
                    if (style === 'skeleton' && !tips.includes(index)) return; // Only tips for skeleton
                    
                    // Specific logic for different styles
                    if (style === 'cyber') {
                         drawParticle(pt.x, pt.y, pt.z, baseColor);
                    } else if (style === 'stardust') {
                         if (p.random(1) > 0.5) drawParticle(pt.x + p.random(-5,5), pt.y + p.random(-5,5), pt.z, baseColor);
                    } else {
                        // Simple
                        p.push();
                        p.translate(pt.x, pt.y, pt.z);
                        p.fill(255);
                        p.sphere(2);
                        p.pop();
                    }
                });
            });

            // 2. Draw "Cat's Cradle" / String Figure Connections (Inter-hand)
            if (hands.length === 2) {
                const leftHand = hands[0];
                const rightHand = hands[1];

                // Logic: Connect Tip to Tip
                // Thumb(4) to Thumb(4), Index(8) to Index(8), etc.
                
                tips.forEach((tipIdx) => {
                    const lPt = leftHand[tipIdx];
                    const rPt = rightHand[tipIdx];
                    
                    // Dynamic White Line (The "String")
                    drawGlowLine(lPt.x, lPt.y, lPt.z, rPt.x, rPt.y, rPt.z, baseColor, 1.5);

                    // Cross connections (Webbing) for cooler effect
                    // Connect Left Thumb to Right Pinky, etc.
                    if (stateRef.current.handStyle === 'cyber') {
                         const lThumb = leftHand[4];
                         const rPinky = rightHand[20];
                         const rThumb = rightHand[4];
                         const lPinky = leftHand[20];
                         
                         // Thinner web lines
                         p.stroke(baseColor);
                         p.strokeWeight(0.5);
                         p.line(lThumb.x, lThumb.y, lThumb.z, rPinky.x, rPinky.y, rPinky.z);
                         p.line(rThumb.x, rThumb.y, rThumb.z, lPinky.x, lPinky.y, lPinky.z);
                    }
                });
                
                // Connect Wrists
                const lWrist = leftHand[0];
                const rWrist = rightHand[0];
                p.stroke(255, 50);
                p.strokeWeight(0.5);
                p.line(lWrist.x, lWrist.y, lWrist.z, rWrist.x, rWrist.y, rWrist.z);
            }
        };

        p.windowResized = () => {
            if (mountRef.current) {
                p.resizeCanvas(mountRef.current.clientWidth, mountRef.current.clientHeight);
            }
        };
    };

    setupMediaPipe();
    
    // Initialize p5 instance
    if (mountRef.current) {
        p5InstanceRef.current = new p5(Sketch, mountRef.current);
    }

    return () => {
      cancelAnimationFrame(requestAnimId);
      if (p5InstanceRef.current) {
          p5InstanceRef.current.remove();
      }
      if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
        mountRef.current?.requestFullscreen();
        setIsFullscreen(true);
    } else {
        document.exitFullscreen();
        setIsFullscreen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
       {/* Hidden Video for MediaPipe */}
       <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-1 h-1" autoPlay playsInline muted></video>

       {/* Canvas Container */}
       <div ref={mountRef} className="flex-grow w-full h-full relative overflow-hidden bg-gradient-to-b from-gray-900 via-black to-gray-900">
          
          {/* HUD Overlay */}
          <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-10 pointer-events-none">
             <div>
                <button 
                    onClick={onBack}
                    className="pointer-events-auto flex items-center gap-2 text-white/70 hover:text-white bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full backdrop-blur-md border border-white/10 transition-all"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                    </svg>
                    Back to Editor
                </button>
                <div className="mt-4">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500" style={{ filter: 'drop-shadow(0 0 10px rgba(0,255,255,0.3))' }}>
                        Digital String Figures
                    </h1>
                    <p className="text-sm text-gray-400 flex items-center gap-2 mt-1">
                        {loading ? 'Initializing Vision AI...' : handDetected ? (
                            <span className="text-cyan-400 flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_currentColor]"></span> 
                                System Online: Tracking
                            </span>
                        ) : (
                            <span className="text-pink-500 flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-pink-500 animate-ping"></span> 
                                Waiting for Two Hands...
                            </span>
                        )}
                    </p>
                </div>
             </div>

             <div className="pointer-events-auto flex flex-col gap-3 items-end">
                <button 
                    onClick={toggleFullscreen}
                    className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md border border-white/10 transition-all hover:scale-105"
                    title="Fullscreen"
                >
                     {isFullscreen ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
                        </svg>
                     ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                        </svg>
                     )}
                </button>
             </div>
          </div>

          {/* Controls Panel */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-3xl px-6 pointer-events-none">
              <div className="bg-black/60 backdrop-blur-2xl border border-white/10 rounded-2xl p-6 pointer-events-auto shadow-[0_0_40px_rgba(0,0,0,0.5)] flex flex-col gap-4">
                  
                  <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                      
                      {/* Model Selector */}
                      <div className="flex flex-col gap-2">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Hand Model</span>
                          <div className="flex bg-white/5 rounded-lg p-1 border border-white/5">
                              {['cyber', 'skeleton', 'stardust'].map(style => (
                                <button 
                                    key={style}
                                    onClick={() => setHandStyle(style as any)}
                                    className={`px-5 py-2 rounded-md text-sm font-bold transition-all uppercase ${handStyle === style ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/20 scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                                >
                                    {style}
                                </button>
                              ))}
                          </div>
                      </div>

                      {/* Divider */}
                      <div className="w-px h-12 bg-white/10 hidden md:block"></div>

                      {/* Color Picker */}
                      <div className="flex flex-col gap-2">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Energy Core</span>
                          <div className="flex gap-3">
                              {['#00ffff', '#ff00ff', '#55ff00', '#ffaa00', '#ffffff'].map((c) => (
                                  <button
                                    key={c}
                                    onClick={() => setColor(c)}
                                    className={`w-10 h-10 rounded-full border-2 transition-all duration-300 hover:scale-110 relative group ${color === c ? 'border-white scale-110 shadow-[0_0_20px_currentColor]' : 'border-white/10 opacity-60 hover:opacity-100 hover:border-white/50'}`}
                                    style={{ backgroundColor: c, color: c }}
                                  >
                                      {color === c && <div className="absolute inset-0 rounded-full bg-white opacity-20 animate-ping"></div>}
                                  </button>
                              ))}
                          </div>
                      </div>
                  </div>
                  
                  <div className="pt-3 border-t border-white/10 text-center">
                      <p className="text-xs text-cyan-200/60 font-mono tracking-wider">
                          Bring both hands into view to activate the Neural String Interface
                      </p>
                  </div>
              </div>
          </div>
       </div>
    </div>
  );
};

export default ParticleExperience;

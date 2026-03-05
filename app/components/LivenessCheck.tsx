'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import type { FacePosition } from '@aigencorp/face-liveness-sdk';
import type { LivenessSDK } from '@aigencorp/face-liveness-sdk';

type Status = 'idle' | 'starting' | 'active' | 'captured' | 'error';

const VIDEO_CONSTRAINTS = {
  facingMode: 'user',
  width: { ideal: 640 },
  height: { ideal: 480 },
};

function loadMediaPipe(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof (window as any).FaceDetection !== 'undefined') {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-mediapipe]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Failed to load MediaPipe face detection'))
      );
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/face_detection.js';
    script.crossOrigin = 'anonymous';
    script.dataset.mediapipe = 'true';
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Failed to load MediaPipe face detection from CDN. Please check your internet connection.'));
    document.head.appendChild(script);
  });
}

function classifyError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'Camera permission denied. Please allow camera access and try again.';
      case 'NotFoundError':
        return 'No camera found on this device. Please connect a camera and try again.';
      case 'NotReadableError':
        return 'Camera is already in use by another application. Please close it and try again.';
      case 'OverconstrainedError':
        return 'Camera does not meet the required constraints. Please try a different camera.';
      default:
        return `Camera error: ${error.message}`;
    }
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred. Please try again.';
}

export default function LivenessCheck() {
  const webcamRef = useRef<Webcam>(null);
  const sdkRef = useRef<LivenessSDK | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faceDetectedRef = useRef(false);
  const [status, setStatus] = useState<Status>('idle');
  const [loadingMessage, setLoadingMessage] = useState('Requesting camera permission...');
  const [guidance, setGuidance] = useState('');
  const [guidanceGood, setGuidanceGood] = useState(false);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      sdkRef.current?.destroy();
    };
  }, []);

  const initSDK = useCallback(async () => {
    const videoEl = webcamRef.current?.video;
    if (!videoEl) return;

    try {
      await loadMediaPipe();
      setLoadingMessage('Initializing face detection...');
      const { createLivenessSDK } = await import('@aigencorp/face-liveness-sdk');
      const sdk = await createLivenessSDK(videoEl);
      sdkRef.current = sdk;
      setLoadingMessage('Starting face scan...');

      sdk.on('camera:ready', () => {
        faceDetectedRef.current = false;
        setStatus('active');
        setGuidance('Position your face in the frame');
        setGuidanceGood(false);
        timeoutRef.current = setTimeout(() => {
          sdk.destroy();
          sdkRef.current = null;
          const msg = faceDetectedRef.current
            ? 'Face scan timed out. Please keep your face centered and at the correct distance, then try again.'
            : 'No face detected. Make sure your face is clearly visible and well-lit, then try again.';
          setErrorMessage(msg);
          setStatus('error');
        }, 30_000);
      });

      sdk.on('face:position', (pos: FacePosition) => {
        faceDetectedRef.current = true;
        if (pos.isCentered && pos.isGoodDistance) {
          setGuidance('Perfect! Hold still...');
          setGuidanceGood(true);
        } else if (pos.isTooClose) {
          setGuidance('Move back a little');
          setGuidanceGood(false);
        } else if (pos.isTooFar) {
          setGuidance('Move closer');
          setGuidanceGood(false);
        } else {
          setGuidance('Center your face in the frame');
          setGuidanceGood(false);
        }
      });

      sdk.on('capture:success', () => {
        setProgress((prev) => Math.min(prev + 25, 100));
      });

      sdk.on('capture:complete', (images: string[]) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setCapturedImages(images);
        setStatus('captured');
        setProgress(100);
        sdk.destroy();
        sdkRef.current = null;
      });

      sdk.on('error', (err: Error) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setErrorMessage(classifyError(err));
        setStatus('error');
      });

      await sdk.captureImages();
    } catch (err) {
      setErrorMessage(classifyError(err));
      setStatus('error');
    }
  }, []);

  const handleUserMedia = useCallback(() => {
    setLoadingMessage('Loading face detection...');
    initSDK();
  }, [initSDK]);

  const handleUserMediaError = useCallback((err: string | DOMException) => {
    setErrorMessage(typeof err === 'string' ? err : classifyError(err));
    setStatus('error');
  }, []);

  const handleStart = () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage(
        'Your browser does not support camera access. Please use Chrome, Firefox, Safari 14+, or Edge.'
      );
      setStatus('error');
      return;
    }
    setProgress(0);
    setLoadingMessage('Requesting camera permission...');
    setStatus('starting');
  };

  const handleReset = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    sdkRef.current?.destroy();
    sdkRef.current = null;
    setStatus('idle');
    setGuidance('');
    setCapturedImages([]);
    setErrorMessage('');
    setProgress(0);
  };

  const showWebcam = status === 'starting' || status === 'active';

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white text-center mb-2">
          Face Liveness Check
        </h1>
        <p className="text-gray-400 text-center text-sm mb-8">
          Verify your identity with a quick face scan
        </p>

        {/* Idle */}
        {status === 'idle' && (
          <div className="bg-gray-900 rounded-2xl p-8 text-center border border-gray-800">
            <div className="w-20 h-20 rounded-full bg-blue-600/20 flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-10 h-10 text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 3C7.031 3 3 7.031 3 12s4.031 9 9 9 9-4.031 9-9-4.031-9-9-9z"
                />
              </svg>
            </div>
            <h2 className="text-white font-semibold text-lg mb-2">Ready to verify</h2>
            <p className="text-gray-400 text-sm mb-6 leading-relaxed">
              Make sure you are in a well-lit area and your face is clearly visible.
              The process takes just a few seconds.
            </p>
            <button
              onClick={handleStart}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors duration-200"
            >
              Start Liveness Check
            </button>
          </div>
        )}

        {/* Camera view */}
        {showWebcam && (
          <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
            <div className="relative aspect-[4/3]">
              <Webcam
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                videoConstraints={VIDEO_CONSTRAINTS}
                onUserMedia={handleUserMedia}
                onUserMediaError={handleUserMediaError}
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />

              {/* Face oval guide */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className="border-2 border-white/40 rounded-full"
                  style={{ width: '55%', height: '80%' }}
                />
              </div>

              {/* Loading overlay */}
              {status === 'starting' && (
                <div className="absolute inset-0 bg-gray-950/70 flex flex-col items-center justify-center">
                  <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-white text-sm">{loadingMessage}</p>
                </div>
              )}

              {/* Guidance overlay */}
              {status === 'active' && guidance && (
                <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                  <span
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors duration-300 ${
                      guidanceGood
                        ? 'bg-green-500 text-white'
                        : 'bg-black/60 text-white border border-white/20'
                    }`}
                  >
                    {guidance}
                  </span>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {status === 'active' && (
              <div className="px-4 py-3">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Capturing images</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Success */}
        {status === 'captured' && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-14 h-14 rounded-full bg-green-600/20 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg mb-1">Liveness Verified</h2>
              <p className="text-gray-400 text-sm mb-4">
                {capturedImages.length} image{capturedImages.length !== 1 ? 's' : ''} captured
                successfully
              </p>
            </div>

            <div className="grid grid-cols-2 gap-1 px-4 pb-4">
              {capturedImages.map((img, i) => (
                <div key={i} className="aspect-square rounded-lg overflow-hidden bg-gray-800">
                  <img
                    src={`data:image/jpeg;base64,${img}`}
                    alt={`Captured frame ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>

            <div className="px-4 pb-4">
              <button
                onClick={handleReset}
                className="w-full bg-gray-800 hover:bg-gray-700 text-white font-medium py-3 px-6 rounded-xl transition-colors duration-200"
              >
                Start Over
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="bg-gray-900 rounded-2xl p-8 text-center border border-gray-800">
            <div className="w-14 h-14 rounded-full bg-red-600/20 flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <h2 className="text-white font-semibold text-lg mb-2">Something went wrong</h2>
            <p className="text-gray-400 text-sm mb-6 leading-relaxed">{errorMessage}</p>
            <button
              onClick={handleReset}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors duration-200"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

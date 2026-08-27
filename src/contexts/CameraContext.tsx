import React, { createContext, useContext, useEffect, useState, useRef } from "react";

interface CameraContextValue {
  localStream: MediaStream | null;
  cameraError: string;
  isReady: boolean;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
}

const CameraContext = createContext<CameraContextValue | null>(null);

export function CameraProvider({ children }: { children: React.ReactNode }) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [isReady, setIsReady] = useState(false);
  const startingRef = useRef(false);

  const startCamera = async () => {
    if (localStream || startingRef.current) return;
    startingRef.current = true;
    setCameraError("");
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      setLocalStream(stream);
      setIsReady(true);
    } catch (error) {
      setCameraError(
        error instanceof Error ? error.message : "Camera access denied",
      );
      setIsReady(true); // ready but failed
    } finally {
      startingRef.current = false;
    }
  };

  const stopCamera = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    setIsReady(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  return (
    <CameraContext.Provider
      value={{ localStream, cameraError, isReady, startCamera, stopCamera }}
    >
      {children}
    </CameraContext.Provider>
  );
}

export function useCamera() {
  const context = useContext(CameraContext);
  if (!context) {
    throw new Error("useCamera must be used within a CameraProvider");
  }
  return context;
}

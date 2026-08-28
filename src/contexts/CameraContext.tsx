import React, { useCallback, useEffect, useRef, useState } from "react";
import { CameraContext } from "./camera-context";

export function CameraProvider({ children }: { children: React.ReactNode }) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [isReady, setIsReady] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);

  const startCamera = useCallback(async () => {
    if (localStreamRef.current || startingRef.current) return;
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
      localStreamRef.current = stream;
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
  }, []);

  const stopCamera = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setCameraError("");
    setIsReady(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  return (
    <CameraContext.Provider
      value={{ localStream, cameraError, isReady, startCamera, stopCamera }}
    >
      {children}
    </CameraContext.Provider>
  );
}

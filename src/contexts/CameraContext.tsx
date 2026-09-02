import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CameraContext } from "./camera-context";

const CAMERA_UNAVAILABLE_MESSAGE =
  "Camera and microphone access is not available in this browser.";

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: "user",
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 30 },
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

function getCameraErrorMessage(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Allow camera and microphone permissions to start matching.";
    }

    if (
      error.name === "NotFoundError" ||
      error.name === "DevicesNotFoundError"
    ) {
      return "No camera or microphone was found on this device.";
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "Camera or microphone is already in use by another app.";
    }

    if (
      error.name === "OverconstrainedError" ||
      error.name === "ConstraintNotSatisfiedError"
    ) {
      return "This camera could not start with the requested settings.";
    }
  }

  return error instanceof Error && error.message
    ? error.message
    : "Camera access failed. Check your device permissions and try again.";
}

export function CameraProvider({ children }: { children: React.ReactNode }) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [isReady, setIsReady] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const startingPromiseRef = useRef<Promise<void> | null>(null);

  const startCamera = useCallback(async () => {
    if (localStreamRef.current) return;
    if (startingPromiseRef.current) return startingPromiseRef.current;

    const startPromise = (async () => {
      try {
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices?.getUserMedia
        ) {
          throw new Error(CAMERA_UNAVAILABLE_MESSAGE);
        }

        setCameraError("");
        const stream =
          await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        localStreamRef.current = stream;
        setLocalStream(stream);
        setIsReady(true);
      } catch (error) {
        const message = getCameraErrorMessage(error);
        setCameraError(message);
        setIsReady(true);
        throw new Error(message);
      } finally {
        startingPromiseRef.current = null;
      }
    })();

    startingPromiseRef.current = startPromise;
    return startPromise;
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

  const value = useMemo(
    () => ({ localStream, cameraError, isReady, startCamera, stopCamera }),
    [cameraError, isReady, localStream, startCamera, stopCamera],
  );

  return (
    <CameraContext.Provider value={value}>{children}</CameraContext.Provider>
  );
}

import { createContext } from "react";

export interface CameraContextValue {
  localStream: MediaStream | null;
  cameraError: string;
  isReady: boolean;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
}

export const CameraContext = createContext<CameraContextValue | null>(null);

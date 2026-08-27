import fs from "fs";

function removeUseServerFn(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");
  
  // Remove import
  content = content.replace(/import { useServerFn } from "@tanstack\/react-start";\n/g, "");
  
  // Remove useServerFn(fnName) bindings
  content = content.replace(/const \w+ = useServerFn\(\w+\);\n/g, "");
  
  // Replace usage
  content = content.replace(/loadProfile\(\)/g, "getMyProfile()");
  content = content.replace(/loadMatchmaking\(\)/g, "getMatchmakingState()");
  content = content.replace(/beginMatching\(\)/g, "startMatching()");
  content = content.replace(/cancelSearch\(\)/g, "cancelMatching()");
  content = content.replace(/endMatch\(\)/g, "endCurrentMatch()");
  content = content.replace(/loadSnapshot\(\)/g, "getLobbySnapshot()");
  content = content.replace(/sendHeartbeat\(\)/g, "heartbeat()");
  content = content.replace(/checkName\(/g, "checkUsername(");
  content = content.replace(/save\(/g, "completeProfile(");
  
  fs.writeFileSync(filePath, content);
}

removeUseServerFn("src/routes/_authenticated/call.tsx");
removeUseServerFn("src/routes/_authenticated/lobby.tsx");
removeUseServerFn("src/routes/_authenticated/onboarding.tsx");

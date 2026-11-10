// src/App.jsx
import { useTelemetry } from './hooks/useTelemetry';
import { useCameraVision } from './hooks/useCameraVision';
import CameraView from './components/CameraView';
import TelemetryHud from './components/TelemetryHud';
import TestManager from './components/TestManager';
import PlaceholderVision from './components/PlaceholderVision';
import MarkerPlayground from './components/MarkerPlayground';

export default function App() {
  if (new URLSearchParams(window.location.search).get('scene') === 'playground') {
    return <MarkerPlayground />;
  }
  if (new URLSearchParams(window.location.search).get('scene') === 'placeholder') {
    return <PlaceholderVision />;
  }
  return <LiveApp />;
}

function LiveApp() {
  const { telemetry, isConnected } = useTelemetry();
  const {
    videoRef,
    canvasRef,
    visionState,
    resetTrajectoryTracking,
    stopTrajectoryTracking,
  } = useCameraVision();

  return (
    <div className="flex min-h-dvh w-full flex-col overflow-x-hidden bg-slate-950 font-sans md:h-dvh md:w-screen md:flex-row md:overflow-hidden">
      <div className="flex min-h-0 w-full flex-col md:h-full md:flex-1">
        <CameraView videoRef={videoRef} canvasRef={canvasRef} />
        <TelemetryHud
          telemetry={telemetry}
          isConnected={isConnected}
          visionState={visionState}
        />
      </div>

      <TestManager
        telemetry={telemetry}
        visionState={visionState}
        onStartTracking={resetTrajectoryTracking}
        onStopTracking={stopTrajectoryTracking}
      />
    </div>
  );
}

import { Composition } from 'remotion';
import { HeroVideo } from './compositions/HeroVideo';
import { LockCoordinationDemo } from './compositions/LockCoordinationDemo';
import { ConflictDetectionDemo } from './compositions/ConflictDetectionDemo';
import { MCPIntegrationDemo } from './compositions/MCPIntegrationDemo';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HeroVideo"
        component={HeroVideo}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          titleText: 'Relay',
          subtitleText: 'The Coordination Layer for AI Coding Agents',
        }}
      />
      <Composition
        id="LockCoordinationDemo"
        component={LockCoordinationDemo}
        durationInFrames={450}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          demoType: 'basic',
        }}
      />
      <Composition
        id="ConflictDetectionDemo"
        component={ConflictDetectionDemo}
        durationInFrames={400}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          showDependencyGraph: true,
        }}
      />
      <Composition
        id="MCPIntegrationDemo"
        component={MCPIntegrationDemo}
        durationInFrames={350}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          showCode: true,
        }}
      />
    </>
  );
};

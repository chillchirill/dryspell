import type { SandboxCommand,SandboxEvent } from '@dryspell/contracts/sandbox';
import { SandboxRuntime } from './controller';

// A narrow worker surface avoids adding WebWorker globals to the shared DOM/server tsconfig.
const scope=self as unknown as {postMessage(event:SandboxEvent):void;onmessage:((event:MessageEvent<SandboxCommand>)=>void)|null};
const runtime=new SandboxRuntime(event=>scope.postMessage(event));
scope.onmessage=event=>runtime.handle(event.data);

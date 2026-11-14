import type {ProfileId} from '@dryspell/contracts';
export function SensorSymbol({profile,size=24}:{profile:ProfileId;size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/>{profile==='combined'?<><path d="M12 7v10M7 12h10"/><circle cx="12" cy="12" r="2.8"/></>:profile==='temperature'?<><path d="M10 14V8a2 2 0 0 1 4 0v6a3.5 3.5 0 1 1-4 0Z"/><path d="M12 10v7"/></>:profile==='humidity'?<path d="M12 6c-1 3-4 5-4 8a4 4 0 0 0 8 0c0-3-3-5-4-8Z"/>:<><path d="M8 17c-3-4 3-4 0-8M12 17c-3-4 3-4 0-10M16 17c-3-4 3-4 0-8"/></>}</svg>;
}

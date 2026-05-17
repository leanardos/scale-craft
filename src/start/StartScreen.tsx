import { MISSIONS } from '../missions';
import { useStore } from '../store/useStore';
import { MissionSpec } from '../sim/mission';
import {
  CustomMissionPrototype,
  VariantKey,
  parseVariant
} from './custom/CustomMissionPrototype';
import { PrototypeSwitcher } from './custom/PrototypeSwitcher';
import { useSearchParam } from './custom/useSearchParam';

interface MissionMeta {
  accent: string;
  tag: string;
  bestScore: number;
}

const META: Record<string, MissionMeta> = {
  'user-service-1k': { accent: '#f4b942', tag: 'Reads', bestScore: 1240 },
  'orders-5k-writes': { accent: '#e76f51', tag: 'Writes', bestScore: 980 },
  'ingest-100k-burst': { accent: '#8ecae6', tag: 'Burst', bestScore: 1820 },
  'timeline-stale-reads': { accent: '#a3b18a', tag: 'Mixed', bestScore: 1407 },
  'survive-region-outage': { accent: '#cdb4db', tag: 'Resilience', bestScore: 957 },
  'p95-marathon': { accent: '#7dd3fc', tag: 'Endurance', bestScore: 1476 }
};

const DEFAULT_META: MissionMeta = { accent: '#94a3b8', tag: 'Mission', bestScore: 0 };
const CUSTOM_ACCENT = '#f472b6';

function metaFor(spec: MissionSpec): MissionMeta {
  return META[spec.id] ?? DEFAULT_META;
}

function formatRps(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export function StartScreen() {
  const missionSpec = useStore((s) => s.missionSpec);
  const selectMission = useStore((s) => s.selectMission);
  const [variantParam, setVariantParam] = useSearchParam('variant');
  const [customMode, setCustomMode] = useSearchParam('custom');

  if (missionSpec) return null;

  const inCustomFlow = customMode === '1';
  const variant: VariantKey = parseVariant(variantParam);

  const enterCustom = () => {
    setVariantParam(variant);
    setCustomMode('1');
  };
  const exitCustom = () => {
    setCustomMode(null);
  };
  const setVariant = (v: VariantKey) => setVariantParam(v);

  if (inCustomFlow) {
    return (
      <>
        <CustomMissionPrototype variant={variant} onExit={exitCustom} />
        <PrototypeSwitcher variant={variant} setVariant={setVariant} />
      </>
    );
  }

  return (
    <div className="sc-start">
      <div className="sc-start__inner">
        <header className="sc-start__header">
          <div className="sc-start__eyebrow">ScaleCraft</div>
          <h1 className="sc-start__title">Pick a mission</h1>
        </header>

        <div className="sc-start__grid">
          {MISSIONS.map((m) => {
            const meta = metaFor(m);
            const w = m.winConditions;
            return (
              <article
                key={m.id}
                className="sc-start__card"
                style={{ ['--accent' as string]: meta.accent }}
              >
                <div className="sc-start__card-top">
                  <span className="sc-start__tag">{meta.tag}</span>
                  <span className="sc-start__best">
                    Best <strong>{meta.bestScore}</strong>
                  </span>
                </div>
                <div className="sc-start__rps">
                  <span className="sc-start__rps-num">{formatRps(m.targetRps)}</span>
                  <span className="sc-start__rps-unit">RPS</span>
                </div>
                <h2 className="sc-start__card-title">{m.title}</h2>
                <p className="sc-start__brief">{m.brief}</p>
                <div className="sc-start__chips">
                  <span className="sc-start__chip">
                    <span>p95</span>
                    <strong>≤{w.p95MaxMs}ms</strong>
                  </span>
                  <span className="sc-start__chip">
                    <span>err</span>
                    <strong>≤{w.errorMaxPct}%</strong>
                  </span>
                  <span className="sc-start__chip">
                    <span>$</span>
                    <strong>≤{w.costMaxUsd}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  className="sc-start__launch"
                  onClick={() => selectMission(m)}
                >
                  Launch →
                </button>
              </article>
            );
          })}

          <article
            className="sc-start__card sc-start__card--custom"
            style={{ ['--accent' as string]: CUSTOM_ACCENT }}
          >
            <div className="sc-start__card-top">
              <span className="sc-start__tag">Custom</span>
              <span className="sc-start__best">Your spec</span>
            </div>
            <div className="sc-start__rps">
              <span className="sc-start__rps-num">∗</span>
              <span className="sc-start__rps-unit">design your own</span>
            </div>
            <h2 className="sc-start__card-title">Build a custom mission</h2>
            <p className="sc-start__brief">
              Pick the traffic, set the SLOs, lock the components. We'll grill you through
              the requirements one at a time, then drop you into the sim.
            </p>
            <div className="sc-start__chips">
              <span className="sc-start__chip">
                <span>RPS</span>
                <strong>yours</strong>
              </span>
              <span className="sc-start__chip">
                <span>SLOs</span>
                <strong>yours</strong>
              </span>
              <span className="sc-start__chip">
                <span>budget</span>
                <strong>yours</strong>
              </span>
            </div>
            <button type="button" className="sc-start__launch" onClick={enterCustom}>
              Design mission →
            </button>
          </article>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { problems, type Problem, type ProblemId } from './problems';
import './problems.css';

function ProblemIllustration({ id }: { id: ProblemId }) {
  if (id === 'nav') return <figure className="st-problem-figure">
    <figcaption>Where does the evidence stop?</figcaption>
    <div className="st-backing-root">Reported NAV</div>
    <div className="st-backing-branches"><span>Assets<small>Positions & prices</small></span><span>Liabilities<small>Debt & fees</small></span><span className="st-unverified">External claims<small>Supporting evidence required</small></span></div>
    <p>Conceptual verification path · not a reconstructed xUSD valuation</p>
  </figure>;
  if (id === 'response') return <figure className="st-problem-figure">
    <figcaption>From an event to a permitted response</figcaption>
    <ol className="st-problem-sequence"><li><small>01 / SIGNAL</small><b>Terms change</b><span>Identify affected markets</span></li><li><small>02 / CONSTRAINTS</small><b>Check the exit</b><span>Liquidity · costs · permissions</span></li><li><small>03 / DECISION</small><b>Compare responses</b><span>Withdraw · hold idle · reallocate</span></li></ol>
    <p>Conceptual workflow · no trade selected or executed</p>
  </figure>;
  if (id === 'stress') return <figure className="st-problem-figure">
    <figcaption>Reported WETH liquidity in the ezETH / WETH Balancer pool</figcaption>
    <div className="st-problem-bars"><div><span>Before decline</span><b>~4,000 WETH</b></div><div className="st-problem-bar"><i style={{ width: '100%' }} /></div><div><span>Reported low</span><b>~500 WETH</b></div><div className="st-problem-bar"><i style={{ width: '12.5%' }} /></div></div>
    <p>Historical pool data · 24 April 2024 · source: Gauntlet’s incident report</p>
    <div className="st-stress-assumptions"><span>Hypothetical test, not run</span><b>ezETH / WETH −10%</b><b>DEX liquidity −50%</b></div>
  </figure>;
  if (id === 'withdrawals') return <figure className="st-problem-figure">
    <figcaption>The exposure stays. The denominator shrinks.</figcaption>
    <div className="st-problem-bars"><div><span>Before · $100m NAV</span><b>20% illiquid</b></div><div className="st-problem-bar st-composition"><i style={{ width: '20%' }} /><span style={{ width: '80%' }} /></div><div><span>After · $60m NAV</span><b>33.3% illiquid</b></div><div className="st-problem-bar st-composition"><i style={{ width: '20%' }} /><span style={{ width: '40%' }} /></div></div>
    <div className="st-problem-legend"><span><i />$20m illiquid allocation</span><span><i />Other liquid positions</span></div>
    <p>Illustrative · bars share a $100m scale · $40m withdrawn from liquid positions</p>
  </figure>;
  return <figure className="st-problem-figure">
    <figcaption>An investment instruction is not a transaction</figcaption>
    <div className="st-execution-intent">“Reduce this exposure”</div>
    <div className="st-execution-checks">{['Exact calls', 'Permissions & proofs', 'Liquidity & approvals', 'Final exposure'].map((label, i) => <span key={label}><small>0{i + 1}</small>{label}<i aria-label="Requires validation">○</i></span>)}</div>
    <p>Validation checkpoints · not a prepared or signable transaction</p>
  </figure>;
}

function ProblemDialog({ problem, close }: { problem: Problem; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    el.showModal();
    document.body.style.overflow = 'hidden';
    return () => { el.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`st-problem-dialog st-problem-${problem.id}`} aria-labelledby="st-problem-dialog-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
    <div className="st-problem-dialog-top"><span className="st-caption">{problem.topic}</span><button onClick={close} aria-label="Close incident details" autoFocus>×</button></div>
    <div className="st-problem-dialog-body">
      <h2 id="st-problem-dialog-title">{problem.question.join(' ')}</h2>
      <div className="st-problem-case"><strong>{problem.example}</strong><span>{problem.date}</span><small>{problem.evidence}</small></div>
      <div className="st-problem-detail-grid"><div><h3>{problem.evidence === 'Historical incident' || problem.id === 'stress' ? 'What happened' : 'The example'}</h3><p>{problem.happened}</p><h3>The operational problem</h3><p>{problem.implication}</p></div><ProblemIllustration id={problem.id} /></div>
      <p className="st-problem-boundary"><strong>Evidence boundary</strong>{problem.boundary}</p>
      <div className="st-problem-sources"><h3>Explore the evidence</h3>{problem.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span><small>{source.kind}</small>{source.label}</span><span aria-hidden="true">↗</span><span className="st-problem-sr"> (opens in a new tab)</span></a>)}</div>
    </div>
  </dialog>;
}

export function ProblemMap() {
  const [selected, setSelected] = useState<Problem | null>(null);
  return <section className="st-section st-problems" id="st-problems" aria-labelledby="st-problems-title">
    <div className="st-problems-heading"><h2 className="st-caption" id="st-problems-title">01 / PROBLEM</h2><p>Explore the operational questions behind real market events.</p></div>
    <div className="st-question-map" role="group" aria-label="Operational questions: See more and Act more. Positions are conceptual, not scores.">
      <div className="st-question-axis st-question-axis-x" aria-hidden="true"><span>See more</span></div>
      <div className="st-question-axis st-question-axis-y" aria-hidden="true"><span>Act more</span></div>
      {problems.map((problem, i) => <button key={problem.id} className={`st-question st-question-${problem.id}`} aria-label={problem.question.join(' ')} aria-haspopup="dialog" onClick={() => setSelected(problem)}>
        <span className="st-question-meta"><i />0{i + 1} / {problem.topic}</span><span className="st-question-text">{problem.question.map((line, index) => <span className="st-question-line" key={line}><span>{line}</span>{index === 2 && <span className="st-question-arrow" aria-hidden="true">↗</span>}</span>)}</span>
      </button>)}
    </div>
    <div className="st-problems-footer"><span>Select a question to explore its context <span aria-hidden="true">↗</span></span><span>Conceptual positions · not a risk ranking</span></div>
    {selected && <ProblemDialog problem={selected} close={() => setSelected(null)} />}
  </section>;
}

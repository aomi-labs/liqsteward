import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { PolicyIndex } from "../nav-types";
import { CopyValue, errorText, formatTime, readJson, short } from "./format";

type UploadResult = { policy_id: string; version: number; digest: string };

export function PolicyPanel({ vault }: { vault: string }) {
  const [index, setIndex] = useState<PolicyIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetch(`/api/nav/policies/${encodeURIComponent(vault)}`)
      .then((response) => readJson<PolicyIndex>(response))
      .then((body) => { if (!cancelled) setIndex(body); })
      .catch((reason: unknown) => { if (!cancelled) { setIndex(null); setLoadError(errorText(reason, "Policy lookup failed")); } });
    return () => { cancelled = true; };
  }, [vault, refresh]);

  async function upload() {
    setUploadError(null);
    setResult(null);
    let body: unknown;
    try {
      body = JSON.parse(draft);
    } catch (reason) {
      setUploadError(`Invalid JSON: ${errorText(reason, "parse error")}`);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/nav/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setResult(await readJson<UploadResult>(response));
      setRefresh((n) => n + 1);
    } catch (reason) {
      setUploadError(errorText(reason, "Upload failed"));
    } finally {
      setBusy(false);
    }
  }

  const latest = index?.latest ?? null;
  const latestMeta = index?.policies[0] ?? null;

  return (
    <div className="nav-policy">
      <section className="nav-block">
        <span className="section-kicker">Latest policy</span>
        {loadError && <div className="nav-inline-error">{loadError}</div>}
        {!index && !loadError && <p className="nav-dim">Loading…</p>}
        {index && !latest && <p className="nav-dim">No policy uploaded for this vault.</p>}
        {latest && (
          <>
            <dl className="nav-rows">
              <div className="nav-row"><dt>Policy id</dt><dd><CopyValue value={latest.policy_id} /></dd></div>
              <div className="nav-row"><dt>Version</dt><dd>{latest.version}</dd></div>
              {(latest.digest ?? latestMeta?.digest) && <div className="nav-row"><dt>Digest</dt><dd><CopyValue value={latest.digest ?? latestMeta?.digest ?? ""} display={short(latest.digest ?? latestMeta?.digest ?? "", 10, 8)} /></dd></div>}
              {latestMeta && <div className="nav-row"><dt>Uploaded</dt><dd>{formatTime(latestMeta.uploaded_at)}</dd></div>}
              <div className="nav-row"><dt>Schema</dt><dd><code>{latest.schema}</code></dd></div>
            </dl>
            <details className="nav-raw">
              <summary>policy JSON</summary>
              <pre>{JSON.stringify(latest, null, 2)}</pre>
            </details>
          </>
        )}
        {index && index.policies.length > 1 && (
          <ul className="nav-list nav-versions">
            {index.policies.map((policy) => (
              <li key={`${policy.policy_id}@${policy.version}`}><code>{policy.policy_id}</code><span>v{policy.version}</span><span className="mono nav-dim">{short(policy.digest, 8, 6)}</span><span className="nav-dim">{formatTime(policy.uploaded_at)}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="nav-block">
        <span className="section-kicker">Posted-view catalog · {index?.catalog.length ?? 0}</span>
        {index && index.catalog.length === 0 && <p className="nav-dim">No posted views registered.</p>}
        {index && index.catalog.length > 0 && (
          <ul className="nav-catalog">
            {index.catalog.map((entry) => (
              <li key={entry.id}>
                <div><code>{entry.id}</code><span className="nav-scope">{entry.scope}</span></div>
                <span className="nav-dim">{entry.adapter_id}</span>
                <p>{entry.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="nav-block">
        <span className="section-kicker">Upload policy</span>
        <textarea
          className="nav-textarea"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={'{ "schema": "nav-policy/v1", "policy_id": "…", "version": 1, … }'}
          spellCheck={false}
          rows={10}
          disabled={busy}
        />
        <div className="nav-upload-row">
          <button type="button" className="button primary" onClick={() => void upload()} disabled={busy || draft.trim().length === 0}>
            {busy ? <LoaderCircle size={13} className="spin" /> : null} Validate & upload
          </button>
          {result && <span className="nav-upload-ok">stored <code>{result.policy_id}</code> v{result.version} · <span className="mono">{short(result.digest, 10, 8)}</span></span>}
        </div>
        {uploadError && <div className="nav-inline-error">{uploadError}</div>}
      </section>
    </div>
  );
}

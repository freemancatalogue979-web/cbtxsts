import { ArrowUpRight, Check, ChevronDown, CircleAlert, Crosshair, Eye, Layers3, Loader2, Minus, Plus, RotateCcw, Target } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { focusHasChanges, focusPayload, parseDrillTarget, toTeamFocusDraft, type TeamFocusDraft } from "../lib/teamFocus";
import type { Meta, Settings } from "../lib/types";
import "./TeamFocusPanel.css";

export function TeamFocusPanel({ meta }: { meta: Meta }) {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<TeamFocusDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const settings = await api.get<Settings>("/admin/settings");
      if (sequence !== loadSequence.current) return;
      setSaved(settings);
      setDraft(toTeamFocusDraft(settings));
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : "Could not load team focus.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, [load]);

  const dirty = Boolean(saved && draft && focusHasChanges(draft, saved));
  const target = draft ? parseDrillTarget(draft.weakness_drills_target) : null;

  function change<K extends keyof TeamFocusDraft>(field: K, value: TeamFocusDraft[K]) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
    setSaveError(null);
    setJustSaved(false);
  }

  function adjustTarget(delta: number) {
    if (target === null) return;
    const next = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, target + delta));
    change("weakness_drills_target", String(next));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const payload = focusPayload(draft);
    if (!payload) {
      setSaveError("Enter a whole number of 0 or more for the drill target.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      const settings = await api.patch<Settings>("/admin/settings", payload);
      setSaved(settings);
      setDraft(toTeamFocusDraft(settings));
      setJustSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save team focus.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!saved) return;
    setDraft(toTeamFocusDraft(saved));
    setSaveError(null);
    setJustSaved(false);
  }

  const status = saving ? "Saving changes" : dirty ? "Unsaved changes" : justSaved ? "Changes saved" : "Up to date";
  const previewWeakness = draft?.current_weakness.trim() || "Your team’s focus will appear here.";
  const previewSeason = draft?.season_name.trim() || "No season label yet";
  const categoryIsListed = draft ? meta.activity_categories.includes(draft.weakness_category) : true;

  return (
    <section className="team-focus" aria-labelledby="team-focus-title">
      <div className="team-focus__section-heading">
        <div className="team-focus__section-name"><h2 id="team-focus-title" className="section-pill">Team focus</h2></div>
        <span className="team-focus__section-tag">Dashboard settings</span>
      </div>

      <div className="team-focus__shell">
        <div className="team-focus__intro">
          <img className="team-focus__watermark" src="/brand/logo.png" alt="" aria-hidden="true" />
          <div className="team-focus__intro-content">
            <div className="team-focus__icon"><Crosshair size={20} strokeWidth={1.8} aria-hidden="true" /></div>
            <div className="team-focus__intro-copy">
              <div className="team-focus__eyebrow section-pill">9 CLOVER <span>/</span> TEAM DEVELOPMENT</div>
              <h3>One team. One focus<span>.</span></h3>
              <p>Turn a team weakness into a clear training goal.</p>
            </div>
          </div>
          <div className="team-focus__scope"><span aria-hidden="true" /> Team-wide</div>
        </div>

        {loading && <div className="team-focus__loading"><Loader2 size={16} className="animate-spin" /> Loading team focus…</div>}
        {!loading && loadError && <div className="team-focus__load-error" role="alert">
          <CircleAlert size={17} aria-hidden="true" /><div><strong>Couldn’t load team focus</strong><p>{loadError}</p></div>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>}

        {!loading && !loadError && draft && saved && (
          <form onSubmit={save}>
            <fieldset className="team-focus__fields" disabled={saving}>
              <div className="team-focus__layout">
                <div className="team-focus__form-column">
                  <div className="team-focus__form-heading">
                    <div><span className="team-focus__eyebrow section-pill">THE GAME PLAN</span><h4>Focus details</h4></div>
                    <span className="team-focus__form-number" aria-hidden="true">01 / 02</span>
                  </div>

                  <div className="team-focus__field">
                    <div className="team-focus__label-row"><label htmlFor="focus-season">Season label</label><span>Optional</span></div>
                    <div className="team-focus__control">
                      <Layers3 className="team-focus__control-icon" size={17} aria-hidden="true" />
                      <input id="focus-season" className="team-focus__input" value={draft.season_name}
                        onChange={(event) => change("season_name", event.target.value)} placeholder="e.g. Season 18" aria-describedby="focus-season-help" />
                    </div>
                    <p id="focus-season-help" className="team-focus__hint">A short label for the current season or training block.</p>
                  </div>

                  <div className="team-focus__field">
                    <div className="team-focus__label-row"><label htmlFor="focus-weakness">Current team weakness</label><span>{draft.current_weakness.length} characters</span></div>
                    <div className="team-focus__control team-focus__control--textarea">
                      <Target className="team-focus__control-icon" size={17} aria-hidden="true" />
                      <textarea id="focus-weakness" className="team-focus__input team-focus__textarea" rows={2}
                        value={draft.current_weakness} onChange={(event) => change("current_weakness", event.target.value)}
                        placeholder="What does the team need to improve?" aria-describedby="focus-weakness-help" />
                    </div>
                    <p id="focus-weakness-help" className="team-focus__hint">This is the priority shown on the team dashboard.</p>
                  </div>

                  <div className="team-focus__compact-grid">
                    <div className="team-focus__field">
                      <div className="team-focus__label-row"><label htmlFor="focus-category">Drill category</label></div>
                      <div className="team-focus__control team-focus__select-wrap">
                        <select id="focus-category" className="team-focus__input team-focus__select" value={draft.weakness_category}
                          onChange={(event) => change("weakness_category", event.target.value)} aria-describedby="focus-category-help">
                          {!draft.weakness_category && <option value="">Choose a category</option>}
                          {!categoryIsListed && draft.weakness_category && <option value={draft.weakness_category}>{draft.weakness_category}</option>}
                          {meta.activity_categories.map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                        <ChevronDown className="team-focus__chevron" size={16} aria-hidden="true" />
                      </div>
                      <p id="focus-category-help" className="team-focus__hint">Completed matching drills in the training block count.</p>
                    </div>

                    <div className="team-focus__field">
                      <div className="team-focus__label-row"><label htmlFor="focus-target">Drills required</label></div>
                      <div className={`team-focus__stepper${target === null ? " team-focus__stepper--invalid" : ""}`}>
                        <button type="button" onClick={() => adjustTarget(-1)} disabled={target === null || target <= 0} aria-label="Decrease drills required"><Minus size={16} aria-hidden="true" /></button>
                        <input id="focus-target" type="number" inputMode="numeric" min={0} max={Number.MAX_SAFE_INTEGER} step={1}
                          value={draft.weakness_drills_target} onChange={(event) => change("weakness_drills_target", event.target.value)}
                          aria-invalid={target === null} aria-describedby="focus-target-help" />
                        <button type="button" onClick={() => adjustTarget(1)} disabled={target === null || target >= Number.MAX_SAFE_INTEGER} aria-label="Increase drills required"><Plus size={16} aria-hidden="true" /></button>
                      </div>
                      <p id="focus-target-help" className={`team-focus__hint${target === null ? " team-focus__hint--error" : ""}`}>
                        {target === null ? "Enter a whole number of 0 or more." : "The team’s target for this block."}
                      </p>
                    </div>
                  </div>
                </div>

                <aside className="team-focus__preview" aria-label="Dashboard preview">
                  <div className="team-focus__preview-top"><div><span className="team-focus__eyebrow section-pill">A LOOK AHEAD</span><h4>Dashboard preview</h4></div><span className="team-focus__preview-icon"><Eye size={16} aria-hidden="true" /></span></div>
                  <div className="team-focus__preview-card">
                    <div className="team-focus__preview-brand">
                      <span className="team-focus__preview-crest"><img src="/brand/logo.png" alt="" aria-hidden="true" /></span>
                      <div><strong>THE HUB</strong><span>{previewSeason}</span></div>
                      <span className="team-focus__preview-badge">PREVIEW</span>
                    </div>
                    <div className="team-focus__preview-divider" />
                    <div className="team-focus__preview-label section-pill">CURRENT TEAM WEAKNESS</div>
                    <div className={`team-focus__preview-weakness${draft.current_weakness.trim() ? "" : " team-focus__preview-weakness--empty"}`}>{previewWeakness}</div>
                    <div className="team-focus__preview-footer">
                      <div><span>DRILL CATEGORY</span><strong>{draft.weakness_category || "Not selected"}</strong></div>
                      <div><span>DRILL TARGET</span><strong>{target === null ? "—" : target.toLocaleString()} <small>{target === 1 ? "drill" : "drills"}</small></strong></div>
                    </div>
                  </div>
                  <p className="team-focus__preview-note"><span aria-hidden="true">✦</span>{draft.current_weakness.trim() ? "Changes appear on the dashboard after saving." : "After saving, no focus appears until a weakness is added."}</p>
                </aside>
              </div>
            </fieldset>

            <div className="team-focus__actions">
              <div className="team-focus__save-state" role="status" aria-live="polite">
                <span className={`team-focus__status-dot${dirty ? " team-focus__status-dot--dirty" : ""}`} aria-hidden="true" />
                <div><strong>{status}</strong><span>{dirty ? "Your edits are not live yet." : saved.current_weakness.trim() ? "Your team sees the saved focus." : saved.current_weakness ? "Saved weakness is blank; clear it to hide the focus." : "Add a weakness to show a focus."}</span></div>
              </div>
              <div className="team-focus__buttons">
                {dirty && <button className="team-focus__discard" type="button" disabled={saving} onClick={discard}><RotateCcw size={14} aria-hidden="true" /> Discard</button>}
                <button className="team-focus__save" type="submit" disabled={saving || target === null}>
                  {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : justSaved && !dirty ? <Check size={16} aria-hidden="true" /> : <Target size={16} aria-hidden="true" />}
                  {saving ? "Saving…" : "Save focus"} <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
            {saveError && <p className="team-focus__save-error" role="alert"><CircleAlert size={15} aria-hidden="true" /> {saveError}</p>}
          </form>
        )}
      </div>
    </section>
  );
}

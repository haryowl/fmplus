import type { InsightBlock, InsightDepth } from "../lib/insight";
import type { InsightSource } from "../lib/aiInsights";
import { insightsSheet } from "../lib/panelExcel";
import { ExportExcelButton } from "./ExportExcelButton";

type Props = {
  blocks: InsightBlock[];
  source: InsightSource;
  onSource: (source: InsightSource) => void;
  depth: InsightDepth;
  onDepth: (depth: InsightDepth) => void;
  aiConfigured: boolean;
  aiLoading: boolean;
  aiError: string;
  aiHasResult: boolean;
  onGenerate: () => void;
};

export function InsightsPanel({
  blocks,
  source,
  onSource,
  depth,
  onDepth,
  aiConfigured,
  aiLoading,
  aiError,
  aiHasResult,
  onGenerate,
}: Props) {
  const usingAi = source === "ai" && aiHasResult;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Vehicle analysis</h2>
          <p>
            {usingAi
              ? "Language-model briefing from the same measured totals. The API key stays on the server. Switch Source back to Template anytime."
              : "Template sentences from the same GPS, CAN, tank, altitude, and vibration numbers. Depth only adds extra clauses. AI is optional when a server key is set."}
          </p>
        </div>
        <div className="panel-head-aside">
          <div className="insight-tools">
            <div className="field">
              <label htmlFor="insight-source">Source</label>
              <select
                id="insight-source"
                value={source}
                onChange={(e) => onSource(e.target.value as InsightSource)}
              >
                <option value="template">Template</option>
                <option value="ai">AI</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="insight-depth">Depth</label>
              <select
                id="insight-depth"
                value={depth}
                onChange={(e) => onDepth(e.target.value as InsightDepth)}
              >
                <option value="standard">Standard</option>
                <option value="detailed">Detailed</option>
              </select>
            </div>
            <button
              className="btn-secondary"
              type="button"
              onClick={onGenerate}
              disabled={!aiConfigured || aiLoading}
            >
              {aiLoading ? "Generating…" : aiHasResult ? "Regenerate AI" : "Generate AI"}
            </button>
          </div>
          <ExportExcelButton
            disabled={blocks.length === 0}
            prefix="vehicle-analysis"
            sheetName="Analysis"
            getRows={() => insightsSheet(blocks)}
          />
        </div>
      </div>
      {source === "ai" && !aiConfigured && (
        <p className="insight-note">
          AI is not configured. Set <code>AI_API_KEY</code> in <code>.env.local</code> (OpenAI-compatible
          endpoint). Template analysis below stays available.
        </p>
      )}
      {source === "ai" && aiConfigured && !aiHasResult && !aiLoading && (
        <p className="insight-note">
          Showing the template until you generate an AI briefing. The template is kept as the
          fallback.
        </p>
      )}
      {aiError && <p className="insight-error">{aiError}</p>}
      <div className="insight-stack">
        {blocks.map((block) => (
          <article key={block.id} className="insight-item">
            <h3>{block.title}</h3>
            <p>{block.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

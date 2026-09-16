"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import {
  isSupabaseConfigured,
  supabase,
  supabaseProjectUrl,
  supabasePublishableKey,
} from "@/lib/supabase";
import {
  blankEodAnswers,
  cloneDefaultEodSchema,
  eodAnswersFromRow,
  type EodAnswers,
  type EodFormSchema,
  normalizeEodSchema,
} from "@/lib/eod-schema";
import { EodDynamicFields } from "@/app/ui/EodDynamicForm";

export default function EodMagicLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState("");
  const [repName, setRepName] = useState("Sales rep");
  const [reportDate, setReportDate] = useState("");
  const [schema, setSchema] = useState<EodFormSchema>(() => cloneDefaultEodSchema());
  const [answers, setAnswers] = useState<EodAnswers>(() => blankEodAnswers(cloneDefaultEodSchema()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    params.then(({ token: value }) => setToken(value));
  }, [params]);
  useEffect(() => {
    if (!token) return;
    if (!isSupabaseConfigured || !supabase) {
      queueMicrotask(() => {
        setError("Supabase is not configured for this app.");
        setLoading(false);
      });
      return;
    }
    fetch(
      `${supabaseProjectUrl}/functions/v1/eod-form?token=${encodeURIComponent(token)}`,
      { headers: { apikey: supabasePublishableKey } },
    )
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!response.ok || !data?.ok)
          setError(data?.error ?? "This EOD link is unavailable.");
        else {
          setRepName(data.repName);
          setReportDate(data.reportDate);
          const nextSchema = normalizeEodSchema(data.schema);
          setSchema(nextSchema);
          setAnswers(eodAnswersFromRow(nextSchema, data.existing ?? {}));
        }
      })
      .catch(() => setError("This EOD link is unavailable."))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    const payload = {
      token,
      answers,
    };
    const { data, error: requestError } = await supabase.functions.invoke(
      "eod-form",
      { body: payload },
    );
    setLoading(false);
    if (requestError || !data?.ok)
      setError(
        requestError?.message ?? data?.error ?? "Could not save the report.",
      );
    else setSaved(true);
  }

  if (loading && !reportDate)
    return (
      <main className="eod-page">
        <LoaderCircle className="spin" /> Loading your EOD report…
      </main>
    );
  if (error && !reportDate)
    return (
      <main className="eod-page">
        <section className="eod-card">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <span className="eyebrow">CHARLES · END OF DAY</span>
          <h1>This EOD link is unavailable.</h1>
          <div className="form-error">{error}</div>
        </section>
      </main>
    );
  return (
    <main className="eod-page">
      <section className="eod-card">
        <div className="brand-mark">
          <Sparkles size={18} />
        </div>
        <span className="eyebrow">CHARLES · END OF DAY</span>
        <h1>{saved ? "You are done for today." : schema.title}</h1>
        {saved ? (
          <div className="email-sent">
            <Check size={22} />
            <strong>Report submitted</strong>
            <span>Charles has your update for {reportDate}.</span>
          </div>
        ) : (
          <>
            <p>{schema.description || `Finish strong, ${repName}. This private link does not require a login.`}</p>
            {error && <div className="form-error">{error}</div>}
            <form className="form-stack" onSubmit={submit}>
              <p className="eod-rep-line">Reporting for {repName} · {reportDate}</p>
              <EodDynamicFields
                schema={schema}
                answers={answers}
                onChange={(fieldId, value) => setAnswers((current) => ({ ...current, [fieldId]: value }))}
              />
              <button className="primary-btn wide" disabled={loading}>
                {loading ? "Saving…" : "Submit EOD report"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

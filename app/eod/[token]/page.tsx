"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import {
  isSupabaseConfigured,
  supabase,
  supabaseProjectUrl,
  supabasePublishableKey,
} from "@/lib/supabase";

export default function EodMagicLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState("");
  const [repName, setRepName] = useState("Sales rep");
  const [reportDate, setReportDate] = useState("");
  const [existing, setExisting] = useState<Record<string, unknown>>({});
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
          setExisting(data.existing ?? {});
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
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = {
      token,
      calls_taken: Number(values.calls_taken),
      connects: Number(values.connects),
      appointments_set: Number(values.appointments_set),
      closes: Number(values.closes),
      revenue: Number(values.revenue),
      wins: values.wins,
      blockers: values.blockers,
      priorities: values.priorities,
      mood: values.mood,
      help_needed: values.help_needed,
      crm_updated: values.crm_updated === "on",
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
        <h1>
          {saved ? "You are done for today." : `Finish strong, ${repName}.`}
        </h1>
        {saved ? (
          <div className="email-sent">
            <Check size={22} />
            <strong>Report submitted</strong>
            <span>Charles has your update for {reportDate}.</span>
          </div>
        ) : (
          <>
            <p>
              Give your manager a clean operating picture. This private link
              does not require a login.
            </p>
            {error && <div className="form-error">{error}</div>}
            <form className="form-stack" onSubmit={submit}>
              <div className="form-grid three">
                <label>
                  Calls
                  <input
                    name="calls_taken"
                    type="number"
                    min="0"
                    defaultValue={Number(existing.calls_taken ?? 0)}
                  />
                </label>
                <label>
                  Connects
                  <input
                    name="connects"
                    type="number"
                    min="0"
                    defaultValue={Number(existing.connects ?? 0)}
                  />
                </label>
                <label>
                  Appointments
                  <input
                    name="appointments_set"
                    type="number"
                    min="0"
                    defaultValue={Number(existing.appointments_set ?? 0)}
                  />
                </label>
                <label>
                  Closes
                  <input
                    name="closes"
                    type="number"
                    min="0"
                    defaultValue={Number(existing.closes ?? 0)}
                  />
                </label>
                <label>
                  Revenue
                  <input
                    name="revenue"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={Number(existing.revenue ?? 0)}
                  />
                </label>
                <label>
                  Energy
                  <select
                    name="mood"
                    defaultValue={String(existing.mood ?? "good")}
                  >
                    <option value="great">Great</option>
                    <option value="good">Good</option>
                    <option value="neutral">Neutral</option>
                    <option value="tough">Tough</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </label>
              </div>
              <label>
                Wins
                <textarea
                  name="wins"
                  defaultValue={String(existing.wins ?? "")}
                />
              </label>
              <label>
                Blockers
                <textarea
                  name="blockers"
                  defaultValue={String(existing.blockers ?? "")}
                />
              </label>
              <label>
                Tomorrow&apos;s priorities
                <textarea
                  name="priorities"
                  defaultValue={String(existing.priorities ?? "")}
                />
              </label>
              <label>
                Help needed
                <textarea
                  name="help_needed"
                  defaultValue={String(existing.help_needed ?? "")}
                />
              </label>
              <label className="check-label">
                <input
                  name="crm_updated"
                  type="checkbox"
                  defaultChecked={Boolean(existing.crm_updated)}
                />{" "}
                CRM is updated
              </label>
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

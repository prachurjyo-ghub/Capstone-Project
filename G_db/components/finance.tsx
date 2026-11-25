"use client";

import { useRef, useState, type FormEvent } from "react";
import { FiArrowDownLeft, FiArrowUpRight, FiEdit2, FiPlus, FiTrash2, FiTrendingUp, FiX } from "react-icons/fi";
import { removeFinanceEntry, saveFinanceEntry, type FinanceEntry } from "./workspace-state";
import { GarageSelect } from "./ui/select";

const number = new Intl.NumberFormat("en-BD", { maximumFractionDigits: 2 });

export function formatMoney(amount: number) {
  return amount < 0 ? `−৳${number.format(-amount / 100)}` : `৳${number.format(amount / 100)}`;
}

export function parseAmount(value: string) {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function FinanceTotals({ entries }: { entries: FinanceEntry[] }) {
  const revenue = entries.filter((entry) => entry.kind === "Revenue");
  const income = revenue.reduce((sum, entry) => sum + entry.amount, 0);
  const expenses = entries.filter((entry) => entry.kind === "Expense").reduce((sum, entry) => sum + entry.amount, 0);
  const net = income - expenses;
  const figures = [
    { label: "Recorded revenue", value: income, icon: FiArrowDownLeft, tone: "green", hint: `${revenue.length} sales entries` },
    { label: "Recorded expenses", value: expenses, icon: FiArrowUpRight, tone: "amber", hint: "Internal costs" },
    { label: net < 0 ? "Net loss" : "Net profit", value: net, icon: FiTrendingUp, tone: net < 0 ? "amber" : "blue", hint: "Revenue minus expenses" },
  ];

  return (
    <div className="metric-grid finance-totals" aria-label="Recorded finance totals">
      {figures.map(({ label, value, icon: Icon, tone, hint }) => (
        <article key={label} className="panel finance-total">
          <span className={`metric-icon tone-${tone}`}><Icon aria-hidden="true" /></span>
          <span className="metric-label">{label}</span>
          <strong>{formatMoney(value)}</strong>
          <small>{hint}</small>
        </article>
      ))}
    </div>
  );
}

export function FinanceView({ entries }: { entries: FinanceEntry[] }) {
  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const [visibleKind, setVisibleKind] = useState("All entries");
  const visible = entries.filter((entry) => visibleKind === "All entries" || entry.kind === visibleKind)
    .sort((a, b) => b.date.localeCompare(a.date));

  function open(entry: FinanceEntry | null) {
    setEditing(entry);
    setError("");
    dialog.current?.showModal();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = parseAmount(String(data.get("amount")).trim());
    const description = String(data.get("description")).trim();
    if (!amount || !description) {
      setError("Enter a description and a positive amount with up to two decimal places.");
      return;
    }
    const saved = await saveFinanceEntry({
      amount, description, date: String(data.get("date")),
      kind: data.get("kind") === "Expense" ? "Expense" : "Revenue",
    }, editing?.id);
    if (!saved) return;
    setVisibleKind("All entries");
    form.reset();
    dialog.current?.close();
  }

  return (
    <>
      <div className="page-heading"><div><h1>Finance</h1><p>Track received payments and garage costs in BDT.</p></div><button type="button" className="button primary" onClick={() => open(null)}><FiPlus aria-hidden="true" /> Add entry</button></div>
      <FinanceTotals entries={entries} />
      <section className="panel ledger" aria-label="Finance entries">
        <div className="list-heading"><div><h2>Activity</h2><p className="muted">{visible.length} {visible.length === 1 ? "entry" : "entries"}</p></div><GarageSelect label="Filter finance entries" value={visibleKind} options={["All entries", "Revenue", "Expense"]} onValueChange={setVisibleKind} compact /></div>
        <ul>
          {visible.map((entry) => (
            <li key={entry.id} className="ledger-row">
              <span className={`metric-icon tone-${entry.kind === "Revenue" ? "green" : "amber"}`}>{entry.kind === "Revenue" ? <FiArrowDownLeft aria-hidden="true" /> : <FiArrowUpRight aria-hidden="true" />}</span>
              <div className="entry-description"><strong>{entry.description}</strong><small>{entry.date} · {entry.kind}</small></div>
              <strong className={entry.kind === "Revenue" ? "revenue-value" : "expense-value"}>{entry.kind === "Revenue" ? "+" : "−"}{formatMoney(entry.amount)}</strong>
              <div className="entry-actions">
                <button className="icon-button" type="button" aria-label={`Edit ${entry.description}`} onClick={() => open(entry)}><FiEdit2 aria-hidden="true" /></button>
                <button className="icon-button" type="button" aria-label={`Delete ${entry.description}`} onClick={() => {
                  if (window.confirm(`Remove “${entry.description}” from the local ledger?`)) removeFinanceEntry(entry.id);
                }}><FiTrash2 aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
        {!visible.length && <p className="empty-state">No finance entries in this view.</p>}
      </section>

      <dialog className="workspace-dialog" ref={dialog} aria-labelledby="finance-dialog-title">
        <div className="dialog-heading"><h2 id="finance-dialog-title">{editing ? "Edit entry" : "Add finance entry"}</h2><button className="icon-button" type="button" aria-label="Close finance form" onClick={() => dialog.current?.close()}><FiX /></button></div>
        <form className="stack-form" onSubmit={save} key={editing?.id ?? "new"}>
          <div className="field-label"><span>Type</span><GarageSelect label="Type" name="kind" defaultValue={editing?.kind ?? "Revenue"} options={["Revenue", "Expense"]} required /></div>
          <label>Description<input name="description" required defaultValue={editing?.description} placeholder="e.g. Labour payment" /></label>
          <label>Amount (BDT)<input name="amount" inputMode="decimal" required defaultValue={editing ? editing.amount / 100 : ""} placeholder="0.00" /></label>
          <label>Date<input name="date" type="date" required defaultValue={editing?.date} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button primary">Save entry</button>
        </form>
      </dialog>
    </>
  );
}

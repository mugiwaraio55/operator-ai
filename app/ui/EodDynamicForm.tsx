"use client";

import type { EodAnswers, EodField, EodFormSchema } from "@/lib/eod-schema";

export function EodDynamicFields({
  schema,
  answers,
  onChange,
}: {
  schema: EodFormSchema;
  answers: EodAnswers;
  onChange: (fieldId: string, value: string | boolean) => void;
}) {
  return (
    <div className="eod-dynamic-fields">
      {schema.sections.map((section) => (
        <section className="eod-dynamic-section" key={section.id}>
          <div className="eod-section-heading">
            <h4>{section.title}</h4>
            {section.description && <p>{section.description}</p>}
          </div>
          <div className="form-grid three">
            {section.fields.map((field) => (
              <EodInput
                key={field.id}
                field={field}
                value={answers[field.id]}
                onChange={(value) => onChange(field.id, value)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EodInput({
  field,
  value,
  onChange,
}: {
  field: EodField;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}) {
  if (field.type === "checkbox") {
    return (
      <label className="check-label eod-field-wide">
        <input
          type="checkbox"
          checked={value === true}
          required={field.required}
          onChange={(event) => onChange(event.target.checked)}
        />{" "}
        {field.label}
      </label>
    );
  }
  if (field.type === "long_text") {
    return (
      <label className="eod-field-wide">
        {field.label}
        <textarea
          required={field.required}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <label>
        {field.label}
        <select
          required={field.required}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
        >
          {!field.required && <option value="">Select one</option>}
          {(field.options ?? []).map((option) => (
            <option value={option} key={option}>
              {humanize(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label>
      {field.label}
      <input
        required={field.required}
        type={field.type === "number" || field.type === "currency" ? "number" : "text"}
        min={field.type === "number" || field.type === "currency" ? "0" : undefined}
        step={field.type === "currency" ? "0.01" : field.type === "number" ? "1" : undefined}
        value={String(value ?? "")}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

import { CopyButton } from "../ui";

/** A ready-to-send message for the person who will connect a real agent. The page fills in the details. */
export default function DeveloperHandoff({ text: t, message }) {
  return (
    <section className="card stack">
      <h2 className="card-t">{t.title}</h2>
      <p>{t.intro}</p>
      <pre className="handoff">{message}</pre>
      <div className="row"><CopyButton text={message} label={t.copy} /></div>
    </section>
  );
}

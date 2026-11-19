import { Component } from "react";

/** Catches a crash in one page so the person sees a readable message instead of a white screen. `text` is the server's shell text. */
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("AgentGuard page error:", error, info?.componentStack); }
  render() {
    const { error } = this.state, t = this.props.text ?? {};
    if (!error) return this.props.children;
    return (
      <div role="alert" className="alert crash">
        <b>{t.error_title}</b>
        <p>{t.error_body}</p>
        <div className="row"><button className="btn primary" onClick={() => { this.setState({ error: null }); this.props.onRetry?.(); }}>{t.retry}</button></div>
        <details><summary>{t.error_details}</summary><pre>{String(error?.stack || error)}</pre></details>
      </div>
    );
  }
}

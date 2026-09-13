"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportAnalysisFailure } from "../../lib/activity-analysis/telemetry";
import styles from "./analysis.module.css";

export default class AnalysisPanelBoundary extends Component<{ activityId: string; name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportAnalysisFailure("projection", error, { activityId: this.props.activityId });
  }

  render() {
    if (this.state.failed) return <section className={styles.panelFailure} role="status"><strong>{this.props.name} is unavailable</strong><p>This panel was isolated after encountering malformed or missing activity data. Other analysis views remain usable.</p><button onClick={() => this.setState({ failed: false })}>Try panel again</button></section>;
    return this.props.children;
  }
}

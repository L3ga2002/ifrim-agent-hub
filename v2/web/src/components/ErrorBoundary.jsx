import { Component } from "react";

/**
 * Contains a render/effect error to one part of the UI so the shell (navigation, Stop All, connection state) keeps
 * working. `resetKey` clears the error when it changes (e.g. the route); `fallback(error, reset)` renders instead.
 * Found in M02 visual review: without a boundary, one thrown error blanked the whole application.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, key: props.resetKey };
    this.reset = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error) {
    // The message only: component stacks can be long and never contain more than the thrown text we already show.
    console.error(`[ui] ${this.props.label || "component"} failed: ${error?.message || error}`);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) return this.props.fallback ? this.props.fallback(this.state.error, this.reset) : null;
    return this.props.children;
  }
}

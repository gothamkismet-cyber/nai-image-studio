import { Component, type ReactNode } from "react";

/** 顶层兜底：渲染异常时给出可恢复界面，避免整屏白屏（本机数据不受影响） */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-zinc-900 p-8 text-zinc-200">
          <p className="text-lg font-semibold">界面出错了（已拦截，你的 token 和历史数据不受影响）</p>
          <p className="max-w-xl text-center text-sm break-all text-zinc-500">{this.state.error.message}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-800"
            >
              尝试恢复
            </button>
            <button
              type="button"
              onClick={() => location.reload()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
            >
              重载应用
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

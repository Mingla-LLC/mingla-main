import React, {
  Component,
  type ComponentType,
  type ReactNode,
  Suspense,
  useState,
} from "react";

import {
  TurnoutIntelContext,
  type TurnoutIntelContextValue,
} from "./TurnoutIntelContext";

type RuntimeValueSink = {
  onValue: (value: TurnoutIntelContextValue | null) => void;
};

class TurnoutIntelLoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Keeps creator children mounted from first paint while intelligence loads as
 * an optional sibling. A pending or rejected chunk therefore removes only
 * intelligence; Save draft and Publish remain owned by the creator.
 */
export const createDeferredTurnoutIntelProvider = <RuntimeProps extends object>(
  loadRuntime: () => Promise<{
    default: ComponentType<RuntimeProps & RuntimeValueSink>;
  }>,
): ComponentType<RuntimeProps & { children: ReactNode }> => {
  const LazyRuntime = React.lazy(loadRuntime);

  const DeferredTurnoutIntelProvider = ({
    children,
    ...runtimeProps
  }: RuntimeProps & { children: ReactNode }): React.JSX.Element => {
    const [value, setValue] = useState<TurnoutIntelContextValue | null>(null);

    return (
      <TurnoutIntelContext.Provider value={value}>
        {children}
        <TurnoutIntelLoadBoundary>
          <Suspense fallback={null}>
            <LazyRuntime
              {...(runtimeProps as RuntimeProps)}
              onValue={setValue}
            />
          </Suspense>
        </TurnoutIntelLoadBoundary>
      </TurnoutIntelContext.Provider>
    );
  };

  DeferredTurnoutIntelProvider.displayName = "DeferredTurnoutIntelProvider";
  return DeferredTurnoutIntelProvider;
};

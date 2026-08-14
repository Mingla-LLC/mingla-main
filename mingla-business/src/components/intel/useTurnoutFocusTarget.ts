import { useEffect, useState } from "react";
import { useTurnoutIntel } from "./TurnoutIntelContext";

export const useTurnoutFocusTarget = (
  target: "name" | "date" | "city" | "price" | "capacity",
  onArrive?: () => void,
): boolean => {
  const intel = useTurnoutIntel();
  const [highlighted, setHighlighted] = useState(false);
  useEffect(() => {
    if (intel?.focusHint !== target || !intel.consumeFocusHint(target)) return;
    onArrive?.();
    setHighlighted(true);
    const timeout = setTimeout(() => setHighlighted(false), 2_000);
    return () => clearTimeout(timeout);
  }, [intel, onArrive, target]);
  return highlighted;
};

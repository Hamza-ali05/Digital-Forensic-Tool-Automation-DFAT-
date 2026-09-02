import { useEffect, useState } from "react";

/**
 * Track document visibility so polling can pause when the tab is hidden.
 */
export default function usePageVisibility() {
  const [visible, setVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  });

  useEffect(() => {
    const onChange = () => {
      setVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}

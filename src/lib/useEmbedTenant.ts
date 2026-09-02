import { useEffect, useMemo, useState } from "react";
import { parseEmbedSearch } from "./embed";
import { bootTenantFromSearch, fetchEmbedContext } from "./tenant";

export function useEmbedTenant() {
  const query = useMemo(() => parseEmbedSearch(window.location.search), []);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [allowedUserIds, setAllowedUserIds] = useState<number[]>([]);
  const [allowedGroupIds, setAllowedGroupIds] = useState<number[]>([]);

  useEffect(() => {
    bootTenantFromSearch(window.location.search);
    const ac = new AbortController();
    fetchEmbedContext(ac.signal)
      .then((ctx) => {
        if (query.tenantKey && !ctx) {
          setError("Unknown embed tenant. Check k= in the iframe URL.");
          return;
        }
        if (ctx && query.appId && Number(query.appId) !== ctx.appId) {
          setError("appId does not match this embed tenant.");
          return;
        }
        if (ctx) {
          setAllowedUserIds(ctx.userIds);
          setAllowedGroupIds(ctx.groupIds);
        }
        setReady(true);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ac.abort();
  }, [query.tenantKey, query.appId]);

  const allowsUser = (id: string | number) =>
    allowedUserIds.length === 0 || allowedUserIds.includes(Number(id));
  const allowsGroup = (id: string | number) =>
    allowedGroupIds.length === 0 || allowedGroupIds.includes(Number(id));

  return { query, ready, error, allowedUserIds, allowedGroupIds, allowsUser, allowsGroup };
}

import { useEffect, useMemo, useState } from "react";
import { applyFieldSessionTenant } from "./deskHome";
import { parseEmbedSearch } from "./embed";
import { defaultEntitlements, type Entitlements } from "./entitlements";
import { bootTenantFromSearch, fetchEmbedContext } from "./tenant";
import { useDeskSession } from "./deskSession";

export function useEmbedTenant() {
  const query = useMemo(() => parseEmbedSearch(window.location.search), []);
  const { user: deskUser, ready: deskReady } = useDeskSession();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [allowedUserIds, setAllowedUserIds] = useState<number[]>([]);
  const [allowedGroupIds, setAllowedGroupIds] = useState<number[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlements>(() => defaultEntitlements());

  useEffect(() => {
    if (!deskReady) return;
    if (deskUser?.tenantKey) applyFieldSessionTenant(deskUser.tenantKey, deskUser.appId);
    else bootTenantFromSearch(window.location.search);
    const ac = new AbortController();
    fetchEmbedContext(ac.signal)
      .then((ctx) => {
        if ((query.tenantKey || deskUser?.tenantKey) && !ctx) {
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
          setEntitlements(ctx.entitlements);
        }
        setReady(true);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => ac.abort();
  }, [deskReady, deskUser?.tenantKey, deskUser?.appId, query.tenantKey, query.appId]);

  const allowsUser = (id: string | number) =>
    allowedUserIds.length === 0 || allowedUserIds.includes(Number(id));
  const allowsGroup = (id: string | number) =>
    allowedGroupIds.length === 0 || allowedGroupIds.includes(Number(id));

  const moduleAllowed = (key: string) => entitlements.modules[key] !== false;

  return {
    query,
    ready,
    error,
    allowedUserIds,
    allowedGroupIds,
    entitlements,
    allowsUser,
    allowsGroup,
    moduleAllowed,
  };
}

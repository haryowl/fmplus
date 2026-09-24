type Props = {
  tenantKey?: string;
  tenantDisplayName?: string;
  username: string;
  displayName?: string;
};

/** Compact signed-in account + user, visible on mobile Field / Manager. */
export function FieldAccountChip({ tenantKey, tenantDisplayName, username, displayName }: Props) {
  const key = String(tenantKey || "").trim();
  const accountName = String(tenantDisplayName || "").trim();
  const account = accountName || key;
  const person = String(displayName || "").trim() || username;
  const showKey = Boolean(key && accountName && accountName !== key);
  const title = [account, showKey ? key : "", person].filter(Boolean).join(" · ");
  return (
    <span className="field-user-chip" title={title}>
      {account ? <strong className="field-user-chip-account">{account}</strong> : null}
      {showKey ? <span className="field-user-chip-id">{key}</span> : null}
      <span className="field-user-chip-user">{person}</span>
    </span>
  );
}

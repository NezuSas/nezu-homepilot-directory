export function invitationDecisionPath(token, decision) {
  return `/directory/invitations/${encodeURIComponent(token)}/${decision}`;
}

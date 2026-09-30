export type LinkableItem = {
  id: string;
  status: string;
  scheduledStart: string;
  scheduledLocalDate: string;
};

export type LinkableActivity = {
  id: string;
  startedAt: string;
  calendarItemId?: string | null;
};

/**
 * Links completed activities to calendar items for display.
 *
 * Rules:
 * - Superseded items are never linked or re-statused; they are historical records.
 * - An activity explicitly tied to an item (calendarItemId) always links to that item.
 * - Otherwise an activity may only be inferred onto a still-`planned` item on the same
 *   local date, and each activity is claimed by at most one item (closest in time wins).
 * - Items that are not linked keep their own status, so planned items stay deletable.
 */
export function linkActivitiesToItems<I extends LinkableItem, A extends LinkableActivity>(
  items: I[],
  activities: A[],
  activityDateKey: (startedAt: string) => string,
): Array<I & { activity?: A }> {
  const claimed = new Set<string>();
  const linkByItem = new Map<string, A>();
  const itemById = new Map(items.map((item) => [item.id, item]));

  for (const activity of activities) {
    const itemId = activity.calendarItemId;
    if (!itemId || claimed.has(activity.id)) continue;
    const item = itemById.get(itemId);
    if (!item || item.status === "superseded" || linkByItem.has(itemId)) continue;
    linkByItem.set(itemId, activity);
    claimed.add(activity.id);
  }

  // Inferred links: pair planned items with unclaimed same-day activities, closest in time first.
  const pairs: Array<{ item: I; activity: A; distance: number }> = [];
  for (const item of items) {
    if (item.status !== "planned" || linkByItem.has(item.id)) continue;
    const itemTime = Date.parse(item.scheduledStart);
    for (const activity of activities) {
      if (claimed.has(activity.id) || activity.calendarItemId) continue;
      if (activityDateKey(activity.startedAt) !== item.scheduledLocalDate) continue;
      pairs.push({ item, activity, distance: Math.abs(Date.parse(activity.startedAt) - itemTime) });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);
  for (const { item, activity } of pairs) {
    if (linkByItem.has(item.id) || claimed.has(activity.id)) continue;
    linkByItem.set(item.id, activity);
    claimed.add(activity.id);
  }

  return items.map((item) => {
    const activity = linkByItem.get(item.id);
    return activity ? { ...item, activity, status: "completed" } : item;
  });
}

import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  type Guild
} from "discord.js";

const managedRuleNames = ["Orbit Anti-Spam", "Orbit Mention Spam"] as const;
const managedRuleNameSet = new Set<string>(managedRuleNames);

export async function syncAutoModerationRules(guild: Guild, enabled: boolean): Promise<void> {
  const rules = await guild.autoModerationRules.fetch();
  const ownedRules = rules.filter(rule =>
    rule.creatorId === guild.client.user.id && managedRuleNameSet.has(rule.name)
  );
  if (!enabled) {
    await Promise.all(ownedRules.map(rule => rule.edit({ enabled: false })));
    return;
  }

  const definitions = [
    { name: managedRuleNames[0], triggerType: AutoModerationRuleTriggerType.Spam },
    {
      name: managedRuleNames[1],
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 5 }
    }
  ];
  for (const definition of definitions) {
    const existing = ownedRules.find(rule => rule.name === definition.name);
    if (existing) {
      if (!existing.enabled) await existing.edit({ enabled: true });
      continue;
    }
    await guild.autoModerationRules.create({
      name: definition.name,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: definition.triggerType,
      triggerMetadata: "triggerMetadata" in definition ? definition.triggerMetadata : undefined,
      actions: [{ type: AutoModerationActionType.BlockMessage }],
      enabled: true,
      reason: "Managed by Orbit dashboard"
    });
  }
}

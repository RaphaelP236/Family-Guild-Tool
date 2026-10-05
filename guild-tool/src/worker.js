const BASE_URL = "https://spellstone.synapse-games.com/api.php";
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!~";
const MAX_RUNE_ID = 1000;

const SHARD_CARD_IDS = new Set([
  ...range(4000, 4112),
  ...range(4500, 4505),
  ...range(5600, 5646),
  ...range(6600, 6632),
  ...range(7600, 7631),
].map(String));

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!hasAccess(url, env)) {
        return htmlResponse(page("Family Guild Tool", "<h1>Access required</h1><p class='error'>Missing or wrong access key.</p>", "", [], url));
      }

      const selectedGuildId = url.searchParams.get("guild") || "";
      const route = url.pathname;

      if (route === "/api/decks") return jsonResponse(await renderDeckHashBatch(request, env, selectedGuildId, url));
      if (route === "/api/decks/refresh-guild") return jsonResponse(await refreshGuildDeckCache(request, env, selectedGuildId, url));
      if (route === "/api/decks/refresh-player") return jsonResponse(await refreshPlayerDeckCache(request, env, selectedGuildId, url));
      if (route === "/api/decks/clear-defence") return jsonResponse(await clearDefenceDeckCache(request, env, selectedGuildId));
      if (route === "/api/war") return htmlResponse(await renderWarRoundPanel(request, env, selectedGuildId));
      if (route === "/api/war-batch") return jsonResponse(await renderWarRoundBatch(request, env, url));
      if (route === "/api/war-snapshot-batch") return jsonResponse(await refreshWarSnapshotBatch(request, env, url));
      if (route === "/") return htmlResponse(await renderHome(request, env, url));
      if (route === "/guild") return htmlResponse(await renderGuildScores(request, env, selectedGuildId, url));
      if (route === "/global") return htmlResponse(await renderGlobalRank(request, env, selectedGuildId, url));
      if (route === "/war") return htmlResponse(await renderWarRound(request, env, selectedGuildId, url));
      if (route === "/war-history") return htmlResponse(await renderWarHistory(request, env, selectedGuildId, url));
      if (route === "/event-history") return htmlResponse(await renderEventHistory(request, env, url));
      if (route === "/online") return htmlResponse(await renderLastOnline(request, env, selectedGuildId, url));
      if (route === "/activity") return htmlResponse(await renderActivity(request, env, selectedGuildId, url));
      if (route === "/chat") return htmlResponse(await renderChat(request, env, selectedGuildId, url));
      if (route === "/decks") return htmlResponse(await renderDeckHashes(request, env, selectedGuildId, url));

      return htmlResponse(page("Not Found", "<h1>Not Found</h1>", "", [], url), 404);
    } catch (error) {
      return htmlResponse(page("Error", `<h1>Error</h1><p class="error">${escapeHtml(error.message || String(error))}</p>`, "", [], new URL(request.url)), 500);
    }
  },
  async scheduled(event, env, ctx) {
    const request = new Request("https://scheduled.local/");
    const now = new Date(event.scheduledTime || Date.now());
    const warSnapshotPhase = scheduledWarSnapshotPhase(now);
    if (warSnapshotPhase) {
      ctx.waitUntil(runScheduledWarSnapshots(request, env, event, warSnapshotPhase));
    }
    if (now.getUTCMinutes() % 5 === 0) {
      ctx.waitUntil(saveCurrentEventHistory(request, env, event));
    }
    if (now.getUTCHours() === 17) {
      ctx.waitUntil(runScheduledDeckRefresh(new Request("https://scheduled.local/?refresh=1"), env, event));
    }
  },
};

function scheduledWarSnapshotPhase(now) {
  const day = now.getUTCDay();
  if (![0, 1, 5, 6].includes(day)) return "";
  if (now.getUTCMinutes() === 5 && [1, 9, 17].includes(now.getUTCHours())) return "after";
  return "";
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function hasAccess(url, env) {
  return !env.ACCESS_KEY || url.searchParams.get("key") === env.ACCESS_KEY;
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function cached(request, key, seconds, loader) {
  const requestUrl = new URL(request.url);
  const refresh = requestUrl.searchParams.has("refresh");
  const cache = caches.default;
  const cacheRequest = new Request(`${requestUrl.origin}/__cache/${encodeURIComponent(key)}`);
  const hit = refresh ? null : await cache.match(cacheRequest);
  if (hit) return hit.json();

  const value = await loader();
  await cache.put(
    cacheRequest,
    new Response(JSON.stringify(value), {
      headers: { "cache-control": `public, max-age=${seconds}` },
    }),
  );
  return value;
}

function withoutRefresh(request) {
  const url = new URL(request.url);
  url.searchParams.delete("refresh");
  return new Request(url.toString(), request);
}

function loadAccounts(env) {
  if (!env.SPELLSTONE_ACCOUNTS) throw new Error("SPELLSTONE_ACCOUNTS secret is not set.");
  const parsed = JSON.parse(env.SPELLSTONE_ACCOUNTS);
  const accounts = Array.isArray(parsed) ? parsed : parsed.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("SPELLSTONE_ACCOUNTS has no accounts.");
  return accounts;
}

async function postSpellstone(message, userId, params) {
  const body = new URLSearchParams(params);
  const response = await fetch(`${BASE_URL}?message=${encodeURIComponent(message)}&user_id=${encodeURIComponent(userId)}`, {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-language": "de,de-DE;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://game248326.konggames.com",
      referer: "https://game248326.konggames.com/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
    },
    body,
  });

  if (!response.ok) throw new Error(`Spellstone ${message} HTTP ${response.status}`);
  return response.json();
}

async function discoverGuilds(request, env) {
  const accountsById = new Map(loadAccounts(env).map((account) => [String(account.user_id), account]));
  const discovered = await cached(request, "discover-guilds", 60, async () => {
    const guilds = {};
    const guildOrder = [];
    const errors = [];

    for (const account of loadAccounts(env)) {
      try {
        const context = await getAccountContext(account);
        const publicContext = { ...context };
        delete publicContext.password;

        if (!context.guild_id || context.guild_id === "0") {
          errors.push(`${account.label}: not currently in a guild`);
          continue;
        }
        if (!guilds[context.guild_id]) {
          guilds[context.guild_id] = [];
          guildOrder.push(context.guild_id);
        }
        guilds[context.guild_id].push(publicContext);
      } catch (error) {
        errors.push(`${account.label}: ${error.message || String(error)}`);
      }
    }

    fillMissingGuildRankingEvents(guilds);

    return { guilds, guild_order: guildOrder, errors };
  });

  attachGuildOrder(discovered.guilds, discovered.guild_order);

  for (const contexts of Object.values(discovered.guilds)) {
    for (const context of contexts) {
      context.password = accountsById.get(String(context.user_id))?.password || "";
    }
  }

  return discovered;
}

function fillMissingGuildRankingEvents(guilds) {
  const eventCounts = new Map();
  for (const contexts of Object.values(guilds)) {
    for (const context of contexts) {
      if (!context.ranking_index) continue;
      const key = String(context.ranking_index);
      const current = eventCounts.get(key) || { count: 0, eventName: context.event_name || "" };
      current.count += 1;
      if (!current.eventName && context.event_name) current.eventName = context.event_name;
      eventCounts.set(key, current);
    }
  }

  const fallback = [...eventCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (!fallback) return;

  const [rankingIndex, meta] = fallback;
  for (const contexts of Object.values(guilds)) {
    for (const context of contexts) {
      if (context.ranking_index) continue;
      context.ranking_index = rankingIndex;
      context.event_name = meta.eventName || "Active guild ranking event";
      context.ranking_index_inherited = true;
    }
  }
}

async function getAccountContext(account) {
  const data = await postSpellstone("getUserAccount", account.user_id, { password: account.password });
  if (!data.common_fields || !data.user_data) throw new Error(messageText(data.result_message) || "getUserAccount failed");

  let [rankingIndex, eventName] = parseCurrentGuildEvent(data.common_fields);
  if (hasSpecialEventType(data.common_fields, "3")) {
    try {
      const warStatus = await getGuildWarStatus({ user_id: account.user_id, password: account.password });
      const warEvent = parseGuildWarRankingEvent(warStatus);
      if (warEvent[0]) [rankingIndex, eventName] = warEvent;
      data.war_match = warStatus.guild_war_current_match || null;
      data.war_active = isGuildWarActive(warStatus);
      data.war_server_time = Number(warStatus.time || 0);
      data.war_tracking_end_time = Number(warStatus.guild_war_event_data?.tracking_end_time || 0);
      data.war_history_count = Array.isArray(warStatus.guild_war_matches) ? warStatus.guild_war_matches.length : 0;
      data.war_history_matches = Array.isArray(warStatus.guild_war_matches) ? warStatus.guild_war_matches : [];
    } catch {
      // Fall back to the ranking event found in common_fields.
    }
  }
  const guildId = String(data.common_fields.guild_id || data.user_data.faction_id || "");
  const context = {
    label: account.label,
    user_id: account.user_id,
    password: account.password,
    auto_refresh: account.auto_refresh === true,
    game_name: data.common_fields.game_username || data.user_data.name || account.label,
    guild_id: guildId,
    guild_name: `Guild ${guildId}`,
    ranking_index: rankingIndex,
    event_name: eventName,
    bge_names: parseBgeNames(data),
    event_time: data.common_fields.event_time || "",
    war_match: data.war_match,
    war_active: data.war_active === true,
    war_server_time: Number(data.war_server_time || 0),
    war_tracking_end_time: Number(data.war_tracking_end_time || 0),
    war_history_count: data.war_history_count || 0,
    war_history_matches: data.war_history_matches || [],
  };

  try {
    const factionData = await getUpdateFaction(context);
    context.guild_name = getGuildNameFromFaction(factionData) || context.guild_name;
  } catch {
    // Guild id is still usable if the faction refresh fails.
  }

  return context;
}

function parseBgeNames(data) {
  const candidates = [];
  try {
    const names = JSON.parse(data?.common_fields?.special_event_names || "[]");
    const ids = JSON.parse(data?.common_fields?.special_event_ids || "[]");
    for (let i = 0; i < ids.length; i += 1) {
      if (String(ids[i]).startsWith("614") && names[i]) candidates.push(names[i]);
    }
  } catch {
    // Fall back to other possible BGE fields below.
  }

  const directKeys = [
    "battleground_effects",
    "battleground_effect_data",
    "current_battleground_effects",
    "current_bges",
    "bges",
  ];

  for (const key of directKeys) candidates.push(data?.[key], data?.common_fields?.[key], data?.user_data?.[key]);
  for (const item of data?.data_cache || []) {
    const name = String(item?.name || item?.id || "").toLowerCase();
    if (name.includes("battleground") || name.includes("bge")) candidates.push(item?.data || item?.value || item);
  }

  const names = new Set();
  const visit = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return;
      if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        try {
          visit(JSON.parse(trimmed));
          return;
        } catch {
          // Use the raw string below.
        }
      }
      if (!/^[a-f0-9]{16,}$/i.test(trimmed)) names.add(trimmed);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      const label = value.name || value.display_name || value.title || value.effect_name || value.battleground_effect_name;
      if (label) names.add(String(label));
      for (const nested of Object.values(value)) {
        if (typeof nested === "object") visit(nested);
      }
    }
  };

  candidates.forEach(visit);
  return [...names].slice(0, 4);
}

function parseCurrentGuildEvent(commonFields) {
  const names = JSON.parse(commonFields.special_event_names || "[]");
  const types = JSON.parse(commonFields.special_event_types || "[]");
  const ids = JSON.parse(commonFields.special_event_ids || "[]");

  for (let i = 0; i < ids.length; i += 1) {
    if (String(types[i]) === "4") return [String(ids[i]), names[i]];
  }
  for (let i = 0; i < ids.length; i += 1) {
    if (isGuildRankingEventName(names[i])) return [String(ids[i]), names[i]];
  }
  return ["", "No active guild event"];
}

function hasSpecialEventType(commonFields, type) {
  try {
    const types = JSON.parse(commonFields.special_event_types || "[]");
    return types.some((value) => String(value) === String(type));
  } catch {
    return false;
  }
}

function parseGuildWarRankingEvent(data) {
  const event = data.guild_war_event_data || {};
  if (!event.id) return ["", ""];

  const serverTime = Number(data.time || Math.floor(Date.now() / 1000));
  const trackingEndTime = Number(event.tracking_end_time || 0);
  const startTime = Number(
    event.start_time ||
    event.event_start_time ||
    event.begin_time ||
    event.clash?.start_time ||
    0
  );
  const placementId = event.linked_event_id || event.clash?.id || "";
  const placementName = event.clash?.name || "Guild War Placements";
  const warIsActive = isGuildWarActive(data);
  const warHistoryCount = Array.isArray(data.guild_war_matches) ? data.guild_war_matches.length : 0;
  const warHasStarted = warIsActive || warHistoryCount > 0 || (startTime > 0 && serverTime >= startTime);

  if (!warHasStarted && placementId && trackingEndTime && serverTime < trackingEndTime) {
    return [String(placementId), placementName];
  }
  return [String(event.id), event.name || "Guild War"];
}

function isGuildWarActive(data) {
  return data?.guild_war_active === true || String(data?.guild_war_active) === "1";
}

function isGuildWarEventContext(context) {
  const eventName = String(context?.event_name || "").toLowerCase();
  return context?.war_active === true || (eventName.includes("guild war") && !eventName.includes("placement"));
}

function isGuildRankingEventName(name) {
  const text = String(name || "").toLowerCase();
  return (
    text.includes("guild war placement") ||
    text.includes("guild placement") ||
    (text.includes("guild") && text.includes("placement"))
  );
}

function getGuildNameFromFaction(data) {
  const faction = data.faction || data.guild || data.faction_info || {};
  return faction.name || faction.faction_name || faction.guild_name || data.faction_name || data.guild_name || data.name || "";
}

async function firstWorkingContext(contexts, fetcher) {
  let lastError = null;
  for (const context of contexts) {
    try {
      return [context, await fetcher(context)];
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No account could fetch this data.");
}

async function getRankings(context, rankingId, rankingIndex = context.ranking_index) {
  if (!rankingIndex) throw new Error("No active guild event.");
  const data = await postSpellstone("getRankings", context.user_id, {
    password: context.password,
    ranking_id: rankingId,
    ranking_index: rankingIndex,
  });
  if (!data.result) throw new Error(messageText(data.result_message) || "getRankings failed");
  return data;
}

async function getUpdateFaction(context) {
  return postSpellstone("updateFaction", context.user_id, {
    password: context.password,
    last_activity_id: 0,
  });
}

async function getGuildFeed(context) {
  return postSpellstone("getGuildFeed", context.user_id, { password: context.password });
}

async function getGuildChat(context) {
  return postSpellstone("getChat", context.user_id, {
    password: context.password,
    chat_room: "guild",
    chat_password: "",
    last_chat_id: 0,
  });
}

async function getGuildWarStatus(context) {
  return postSpellstone("getGuildWarStatus", context.user_id, {
    password: context.password,
    platform: "web",
  });
}

async function getProfileDeck(context, targetUserId) {
  const data = await postSpellstone("getProfileData", context.user_id, {
    password: context.password,
    target_user_id: targetUserId,
  });

  if (data.result === false) throw new Error(messageText(data.result_message) || "getProfileData failed");
  const playerInfo = data.player_info || {};
  const extracted = deckFromObject(playerInfo.deck || {}) || deckFromObject(playerInfo) || findDeckInResponse(data);
  const deck = extracted ? { commander: extracted.commander, units: extracted.units } : null;
  if (!deck?.commander || !deck?.units?.length) {
    const playerInfoKeys = playerInfo && typeof playerInfo === "object" ? Object.keys(playerInfo).join(",") : "";
    throw new Error(`No profile deck found (${playerInfoKeys || "no player_info"})`);
  }

  return {
    name: playerInfo.name || String(targetUserId),
    deck_name: playerInfo.deck?.name || playerInfo.deck_name || "",
    hash: deckToHash(deck),
  };
}

async function debugProfileData(request, env, guildId, url) {
  const nameQuery = (url.searchParams.get("name") || "").toLowerCase();
  const userIdQuery = url.searchParams.get("user_id") || "";
  const { guilds } = await discoverGuilds(request, env);
  const guildEntries = guildId && guilds[guildId] ? [[guildId, guilds[guildId]]] : orderedGuildEntries(guilds);
  const suggestions = [];
  let context = null;
  let member = null;

  for (const [, contexts] of guildEntries) {
    try {
      const [candidateContext, factionData] = await firstWorkingContext(contexts, getUpdateFaction);
      const members = getMemberRows(factionData);
      const candidateMember = members.find((row) => {
        const name = String(getValue(row, ["name", "username", "user_name", "player_name"])).toLowerCase();
        const userId = String(getValue(row, ["user_id", "id", "uid"]));
        return (userIdQuery && userId === userIdQuery) || (nameQuery && name.includes(nameQuery));
      });

      if (candidateMember) {
        context = candidateContext;
        member = candidateMember;
        break;
      }

      for (const row of members.slice(0, 80)) {
        const name = String(getValue(row, ["name", "username", "user_name", "player_name"]));
        if (!nameQuery || name.toLowerCase().includes(nameQuery.slice(0, 3))) {
          suggestions.push({ guild: candidateContext.guild_name, name, user_id: String(getValue(row, ["user_id", "id", "uid"])) });
        }
      }
    } catch (error) {
      suggestions.push({ guild: contexts[0]?.guild_name || "Unknown", error: error.message || String(error) });
    }
  }

  if (!member || !context) {
    return {
      error: "Member not found",
      hint: "Use ?name=part-of-name or ?user_id=... . If the name has special characters, copy it from the Deck Hashes table.",
      searched_guilds: guildEntries.map(([, contexts]) => contexts[0]?.guild_name || "Unknown"),
      suggestions: suggestions.slice(0, 20),
    };
  }

  const targetUserId = String(getValue(member, ["user_id", "id", "uid"]));
  const data = await postSpellstone("getProfileData", context.user_id, {
    password: context.password,
    target_user_id: targetUserId,
  });

  return {
    guild: context.guild_name,
    source_account: context.label,
    target_name: getValue(member, ["name", "username", "user_name", "player_name"]),
    target_user_id: targetUserId,
    top_level_keys: Object.keys(data),
    player_info_keys: data.player_info && typeof data.player_info === "object" ? Object.keys(data.player_info) : [],
    deck_locations: findDeckLocations(data),
    result: data.result ?? null,
    result_message: data.result_message ?? null,
  };
}

function findDeckLocations(root) {
  const locations = [];
  const seen = new Set();
  const stack = [{ value: root, path: "$" }];

  while (stack.length) {
    const { value: current, path } = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    const keys = Object.keys(current);
    const hasCommander = keys.includes("commander") || keys.includes("defend_commander") || keys.includes("defense_commander") || keys.includes("enemy_commander");
    const hasUnits = keys.includes("units") || keys.includes("cards") || keys.includes("card_map") || keys.includes("deck") || keys.includes("enemy_deck") || keys.includes("defend_deck");
    if (hasCommander || hasUnits || keys.some((key) => key.toLowerCase().includes("deck"))) {
      locations.push({
        path,
        keys,
        commander: summarizeCard(current.commander || current.defend_commander || current.defense_commander || current.enemy_commander),
        units_count: Array.isArray(current.units) ? current.units.length : null,
        cards_count: Array.isArray(current.cards) ? current.cards.length : null,
        card_map_count: current.card_map && typeof current.card_map === "object" ? Object.keys(current.card_map).length : null,
      });
    }

    if (Array.isArray(current)) {
      current.forEach((item, index) => stack.push({ value: item, path: `${path}[${index}]` }));
    } else {
      for (const [key, child] of Object.entries(current)) {
        if (child && typeof child === "object") stack.push({ value: child, path: `${path}.${key}` });
      }
    }
  }

  return locations.slice(0, 30);
}

function summarizeCard(card) {
  if (!card || typeof card !== "object") return null;
  return {
    id: card.id ?? null,
    unit_id: card.unit_id ?? null,
    level: card.level ?? null,
    keys: Object.keys(card).slice(0, 20),
  };
}

async function getEnemyDeckFromFight(context, targetUserId) {
  const data = await postSpellstone("fightGuildMember", context.user_id, {
    password: context.password,
    target_user_id: targetUserId,
    include_tower: 1,
  });

  if (data.result === false) throw new Error(messageText(data.result_message) || "fightGuildMember failed");

  const battle = data.battle_data || data.battle || data;
  const extracted = findDeckInResponse(battle) || findDeckInResponse(data);
  const commander = extracted?.commander;
  const units = extracted?.units || [];

  if (!commander || !units.length) throw new Error("No enemy deck found");
  return {
    name: battle.enemy_name || String(targetUserId),
    hash: deckToHash({ commander, units }),
  };
}

function findDeckInResponse(root) {
  const seen = new Set();
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    const deck = deckFromObject(current);
    if (deck) return deck;

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else {
      for (const value of Object.values(current)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
  }

  return null;
}

function deckFromObject(source) {
  const nestedDeck =
    source.defend_deck ||
    source.defense_deck ||
    source.enemy_deck ||
    source.deck_defense ||
    source.deck;

  if (nestedDeck && typeof nestedDeck === "object" && !Array.isArray(nestedDeck)) {
    const nested = deckFromObject(nestedDeck);
    if (nested) return nested;
  }

  const commander =
    source.defend_commander ||
    source.defense_commander ||
    source.enemy_commander ||
    source.commander_defense ||
    source.commander;

  let units = [];
  if (Array.isArray(source.units)) units = source.units.filter(isCardLike);
  if (!units.length && Array.isArray(source.cards)) units = source.cards.filter(isCardLike).filter((card) => card !== commander && !isCommanderLike(card));
  if (!units.length && Array.isArray(nestedDeck)) units = nestedDeck.filter(isCardLike);
  if (!units.length) units = findEnemyUnits(source);

  if (isCardLike(commander) && units.length) return { commander, units };
  return null;
}

function findEnemyUnits(battle) {
  const directDeck =
    battle.defend_deck ||
    battle.defense_deck ||
    battle.enemy_deck ||
    battle.deck_defense ||
    battle.deck;

  if (Array.isArray(directDeck)) return directDeck.filter(isCardLike);
  if (directDeck && Array.isArray(directDeck.units)) return directDeck.units.filter(isCardLike);

  const cardMap = battle.card_map || battle.cards || battle.units || {};
  const cards = Array.isArray(cardMap) ? cardMap : Object.values(cardMap);

  const explicitEnemyCards = cards.filter((card) => {
    if (!isCardLike(card)) return false;
    const owner = String(card.owner || card.player || card.side || card.team || card.controller || "");
    const position = Number(card.position || card.index || card.slot || card.card_uid || card.uid || 0);
    return /enemy|defend|defense|opponent|2/.test(owner.toLowerCase()) || position >= 101;
  });
  if (explicitEnemyCards.length) return explicitEnemyCards;

  const enemySize = Number(battle.enemy_size || 15);
  const indexedEnemyCards = [];
  for (let index = 101; index < 101 + enemySize; index += 1) {
    const card = cardMap[String(index)] || cardMap[index];
    if (isCardLike(card)) indexedEnemyCards.push(card);
  }
  if (indexedEnemyCards.length) return indexedEnemyCards;

  return cards.filter(isCardLike).filter((card) => !isCommanderLike(card));
}

function isCardLike(card) {
  return !!card && typeof card === "object" && (card.unit_id != null || card.id != null) && (card.level != null || card.runes != null || card.skill != null);
}

function isCommanderLike(card) {
  return String(card.card_type || card.type || "") === "1" || String(card.is_commander || "") === "1";
}

async function getBestDeckHash(context, targetUserId) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await getProfileDeck(context, targetUserId);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleep(700);
    }
  }
  throw lastError;
}

async function renderHome(request, env, url) {
  const { guilds, errors } = await discoverGuilds(request, env);
  const body = errors.length ? discoveryErrors(errors) : "";
  return page("Family Guild Tool", body, "", guilds, url);
}

async function renderGuildScores(request, env, guildId, url) {
  return cached(request, `guild-scores:${guildId || "first"}`, 60, async () => {
    const { guilds, errors } = await discoverGuilds(request, env);
    const activeGuildId = selectedOrFirstGuild(guilds, guildId);
    if (!Object.keys(guilds).length) return page("Guilds", `<h1>Guilds</h1><div class='card'>No guilds discovered.</div>${discoveryErrors(errors)}`, "guild", guilds, url);
    const allContexts = Object.values(guilds).flat();

    const buttons = [];
    const panels = [];

    for (const [currentGuildId, contexts] of orderedGuildEntries(guilds)) {
      const guildName = contexts[0].guild_name;
      const activeClass = currentGuildId === activeGuildId ? " active" : "";
      buttons.push(`<a class="guild-link${activeClass}" href="#" data-guild="${escapeHtml(currentGuildId)}">${escapeHtml(guildName)}</a>`);

      try {
        if (!contexts.some((context) => context.ranking_index)) {
          panels.push(`<div id="guild-panel-${escapeHtml(currentGuildId)}" class="guild-panel${currentGuildId === activeGuildId ? " active" : ""}"><h1>${escapeHtml(guildName)}</h1><div class="card"><p class="muted">No active guild ranking event right now.</p><p>Guild Rank will show scores here when the next guild ranking event starts.</p></div></div>`);
          continue;
        }
        const [context, data] = await firstWorkingContext(contexts, (c) => getRankings(c, "event_guild"));
        let rows = addCurrentRanks(data.rankings.data || []);
        let emptyRankingFallback = false;
        let globalRankingFallback = false;
        if (!rows.length) {
          const [, factionData] = await firstWorkingContext(contexts, getUpdateFaction);
          const members = getMemberRows(factionData);
          const globalRowsByName = await getGlobalRankingRowsByName(allContexts);
          let matchedGlobalRows = 0;
          rows = addCurrentRanks(members.map((member) => {
            const name = getValue(member, ["name", "username", "user_name", "player_name"]);
            const globalRow = globalRowsByName.get(normalizeName(name));
            if (globalRow) matchedGlobalRows += 1;
            return {
              rank: globalRow?.rank ?? "",
              name,
              stat: globalRow?.stat ?? 0,
            };
          }));
          emptyRankingFallback = rows.length > 0;
          globalRankingFallback = matchedGlobalRows > 0;
        }
        const warSnapshots = await readWarSnapshots(env, currentGuildId, context.ranking_index);
        const warRounds = isGuildWarEventContext(context) ? getDisplayWarRounds(context, warSnapshots) : [];
        let panel = `<div id="guild-panel-${escapeHtml(currentGuildId)}" class="guild-panel${currentGuildId === activeGuildId ? " active" : ""}">
<h1>${escapeHtml(context.guild_name)}</h1>
<div class="card">
  <div class="muted">Event: ${escapeHtml(context.event_name)}</div>
  ${emptyRankingFallback ? `<div class="muted-small">${globalRankingFallback ? "Guild member ranking was empty; scores were matched from Global Rank where available." : "No scoring rows returned by Spellstone yet; showing current guild members with 0 points."}</div>` : ""}
  <button class="copy-button" type="button" data-export-table="guild-rank-table-${escapeHtml(currentGuildId)}" data-export-title="${escapeHtml(`${context.guild_name} - ${context.event_name}`)}">Export Rank</button>
  <button class="copy-button" type="button" data-screenshot-mode="1">Screenshot Mode</button>
</div>
<table class="compact-table sortable-table" id="guild-rank-table-${escapeHtml(currentGuildId)}">
  <tr><th class="number" data-sort-col="0" data-sort-type="number">Current Rank</th><th data-sort-col="1" data-sort-type="text">Name</th>${warRounds.map((round, index) => `<th class="number" data-sort-col="${2 + index}" data-sort-type="number">Round ${escapeHtml(round.round)}<br><span class="muted-small">${escapeHtml(round.enemy_name || "Enemy")}</span></th>`).join("")}<th class="number" data-sort-col="${2 + warRounds.length}" data-sort-type="number">Overall Rank</th><th class="number" data-sort-col="${3 + warRounds.length}" data-sort-type="number">Total Points</th></tr>`;

        for (const row of rows) {
          const totalPoints = row.stat == null || row.stat === "" || row.stat === "None" ? 0 : row.stat;
          const roundCells = warRounds.map((round) => {
            const players = round.players || null;
            const player = players?.[normalizeName(row.name)] || null;
            return `<td class="number">${players ? escapeHtml(player?.score ?? 0) : ""}</td>`;
          }).join("");
          panel += `<tr><td class="number">${escapeHtml(row.current_rank)}</td><td>${escapeHtml(row.name)}</td>${roundCells}<td class="number">${escapeHtml(row.rank ?? "")}</td><td class="number">${escapeHtml(totalPoints)}</td></tr>`;
        }
        panel += "</table></div>";
        panels.push(panel);
      } catch (error) {
        panels.push(`<div id="guild-panel-${escapeHtml(currentGuildId)}" class="guild-panel${currentGuildId === activeGuildId ? " active" : ""}"><h1>${escapeHtml(guildName)}</h1><p class="error">Could not load guild scores: ${escapeHtml(error.message || String(error))}</p></div>`);
      }
    }

    const key = url.searchParams.get("key") || "";
    const body = `<div class="card">
  <button class="copy-button" type="button" id="refresh-war-snapshots">Refresh War Rounds</button>
  <span class="muted" id="refresh-war-snapshots-status"></span>
</div>
<div class="guild-links" id="guild-tabs">${buttons.join("")}</div>${panels.join("")}
<script>
(function(){
  var button=document.getElementById('refresh-war-snapshots');
  var status=document.getElementById('refresh-war-snapshots-status');
  if(!button) return;
  var guilds=${JSON.stringify(orderedGuildIds(guilds))};
  var key=${JSON.stringify(key)};
  async function refreshBatch(batch, refresh){
    var api=new URL('/api/war-snapshot-batch', window.location.origin);
    api.searchParams.set('guilds', batch.join(','));
    api.searchParams.set('refresh', refresh);
    if(key) api.searchParams.set('key', key);
    var response=await fetch(api.pathname+api.search, {cache:'no-store'});
    if(!response.ok) throw new Error('Refresh failed');
    await response.json();
  }
  button.addEventListener('click', async function(){
    var original=button.textContent;
    var refresh=String(Date.now());
    button.disabled=true;
    button.textContent='Refreshing...';
    if(status) status.textContent='Updating war round snapshots';
    try{
      for(var i=0;i<guilds.length;i+=5){
        await refreshBatch(guilds.slice(i,i+5), refresh);
      }
      var next=new URL(window.location.href);
      next.searchParams.set('refresh', refresh);
      window.location.href=next.pathname+next.search;
    }catch(error){
      button.disabled=false;
      button.textContent=original;
      if(status) status.textContent=String(error);
    }
  });
})();
</script>`;
    return page("Guild Scores", body, "guild", guilds, withGuild(url, activeGuildId));
  });
}

async function renderGlobalRank(request, env, selectedGuildId, url) {
  return cached(request, `global-rank:${selectedGuildId || "first"}`, 60, async () => {
    const { guilds } = await discoverGuilds(request, env);
    const contexts = Object.values(guilds).flat();
    const normalizeName = (name) => String(name || "").trim().toLowerCase();
    const toolGuildNames = new Set(contexts.map((context) => normalizeName(context.guild_name)).filter(Boolean));
    const toolAccountNames = new Set(contexts.map((context) => normalizeName(context.game_name || context.label)).filter(Boolean));
    if (!contexts.length) return page("Global Rank", "<h1>Global Rank</h1><p>No working account available.</p>", "global", guilds, url);
    if (!contexts.some((context) => context.ranking_index)) {
      return page("Global Rank", "<h1>Global Rank</h1><div class='card'><p class='muted'>No active guild ranking event right now.</p><p>Global Rank will show scores here when the next guild ranking event starts.</p></div>", "global", guilds, url);
    }

    const merged = new Map();
    let eventName = "";
    for (const context of contexts) {
      try {
        const data = await getRankings(context, "event");
        eventName ||= context.event_name;
        for (const row of data.rankings.data || []) {
          const key = String(row.name || row.user_id || row.rank).trim().toLowerCase();
          const old = merged.get(key);
          if (!old || Number(row.rank || 999999) < Number(old.rank || 999999)) merged.set(key, row);
        }
      } catch {
        // Try the next account.
      }
    }

    const rows = [...merged.values()].sort((a, b) => Number(a.rank || 999999) - Number(b.rank || 999999));
    const rankingNames = new Set(rows.map((row) => normalizeName(row.name)));
    const hasToolAccountsInRanking = [...toolAccountNames].some((name) => rankingNames.has(name));
    const highlightedNames = hasToolAccountsInRanking ? toolAccountNames : toolGuildNames;
    let body = `<h1>Global Rank</h1>
<div class="card">
  <div class="muted">Event: ${escapeHtml(eventName)}</div>
  <button class="copy-button" type="button" data-export-table="global-rank-table" data-export-title="${escapeHtml(`Global Rank - ${eventName}`)}">Export Rank</button>
</div>
<table class="compact-table" id="global-rank-table"><tr><th class="number">Overall Rank</th><th>Name</th><th class="number">Total Points</th></tr>`;
    for (const row of rows) {
      const name = value(row.name);
      const rowClass = highlightedNames.has(normalizeName(name)) ? ' class="tool-guild-row"' : "";
      body += `<tr${rowClass}><td class="number">${escapeHtml(row.rank)}</td><td>${escapeHtml(name)}</td><td class="number">${escapeHtml(row.stat)}</td></tr>`;
    }
    body += "</table>";
    return page("Global Rank", body, "global", guilds, url);
  });
}

async function getGlobalRankingRowsByName(contexts) {
  const rowsByName = new Map();
  for (const context of contexts) {
    try {
      const data = await getRankings(context, "event");
      for (const row of data.rankings?.data || []) {
        const key = normalizeName(row.name);
        if (!key) continue;
        const old = rowsByName.get(key);
        if (!old || Number(row.rank || 999999) < Number(old.rank || 999999)) rowsByName.set(key, row);
      }
    } catch {
      // Try the next account.
    }
  }
  return rowsByName;
}

async function renderWarRound(request, env, guildId, url) {
  const { guilds, errors } = await discoverGuilds(withoutRefresh(request), env);
  const activeGuildId = selectedOrFirstGuild(guilds, guildId);
  if (!Object.keys(guilds).length) return page("War Round", `<h1>War Round</h1><div class='card'>No guilds discovered.</div>${discoveryErrors(errors)}`, "war", guilds, url);

  const key = url.searchParams.get("key") || "";
  const refreshValue = url.searchParams.get("refresh") || String(Date.now());
  const buttons = [];
  const panels = [];

  for (const [currentGuildId, contexts] of orderedGuildEntries(guilds)) {
    const activeClass = currentGuildId === activeGuildId ? " active" : "";
    buttons.push(`<a class="guild-link${activeClass}" href="#" data-guild="${escapeHtml(currentGuildId)}">${escapeHtml(contexts[0].guild_name)}</a>`);
    panels.push(`<div id="guild-panel-${escapeHtml(currentGuildId)}" class="guild-panel${currentGuildId === activeGuildId ? " active" : ""}" data-war-panel="${escapeHtml(currentGuildId)}"><div class="card"><p class="muted">Loading ${escapeHtml(contexts[0].guild_name)}...</p></div></div>`);
  }

  const body = `<div class="guild-links" id="guild-tabs">${buttons.join("")}</div>${panels.join("")}
<script>
(function(){
  var guilds=${JSON.stringify(orderedGuildIds(guilds))};
  var key=${JSON.stringify(key)};
  var refresh=${JSON.stringify(refreshValue)};
  var batchSize=5;
  function batchUrl(batch){
    var url=new URL('/api/war-batch', window.location.origin);
    url.searchParams.set('guilds', batch.join(','));
    url.searchParams.set('refresh', refresh);
    if(key) url.searchParams.set('key', key);
    return url.pathname+url.search;
  }
  async function loadBatch(batch){
    var response=await fetch(batchUrl(batch), {cache:'no-store'});
    var data=await response.json();
    Object.keys(data.panels || {}).forEach(function(guild){
      var panel=document.querySelector('[data-war-panel="'+guild+'"]');
      if(panel) panel.innerHTML=data.panels[guild];
    });
  }
  async function loadAll(){
    var batches=[];
    for(var i=0;i<guilds.length;i+=batchSize){
      batches.push(guilds.slice(i,i+batchSize));
    }
    await Promise.all(batches.map(async function(batch){
      try {
        await loadBatch(batch);
      } catch(error) {
        batch.forEach(function(guild){
          var panel=document.querySelector('[data-war-panel="'+guild+'"]');
          if(panel) panel.innerHTML='<p class="error">Could not load war round scores: '+String(error)+'</p>';
        });
      }
    }));
  }
  loadAll();
})();
</script>`;
  return page("War Round", body, "war", guilds, withGuild(url, activeGuildId));
}

async function renderWarRoundPanel(request, env, guildId) {
  return cached(request, `war-round-panel:${guildId || "first"}`, 20, async () => {
    const { guilds } = await discoverGuilds(withoutRefresh(request), env);
    const activeGuildId = selectedOrFirstGuild(guilds, guildId);
    const contexts = guilds[activeGuildId];
    if (!contexts) return `<h1>Guild not found</h1><p>No discovered guild with that ID.</p>`;
    return renderWarRoundPanelForContexts(env, activeGuildId, contexts);
  });
}

async function renderWarRoundBatch(request, env, url) {
  return cached(request, `war-round-batch:${url.searchParams.get("guilds") || "none"}`, 20, async () => {
    const { guilds } = await discoverGuilds(withoutRefresh(request), env);
    const requested = (url.searchParams.get("guilds") || "")
      .split(",")
      .map((guildId) => guildId.trim())
      .filter((guildId) => guilds[guildId])
      .slice(0, 5);
    const panels = {};

    for (const guildId of requested) {
      panels[guildId] = await renderWarRoundPanelForContexts(env, guildId, guilds[guildId]);
    }

    return { panels };
  });
}

async function refreshWarSnapshotBatch(request, env, url) {
  return cached(request, `war-snapshot-batch:${url.searchParams.get("guilds") || "none"}`, 1, async () => {
    const { guilds } = await discoverGuilds(withoutRefresh(request), env);
    const requested = (url.searchParams.get("guilds") || "")
      .split(",")
      .map((guildId) => guildId.trim())
      .filter((guildId) => guilds[guildId])
      .slice(0, 5);
    const results = {};

    for (const guildId of requested) {
      try {
        await refreshWarSnapshotForGuild(env, guildId, guilds[guildId], "after");
        results[guildId] = { result: true };
      } catch (error) {
        results[guildId] = { result: false, error: error.message || String(error) };
      }
    }

    return { results };
  });
}

async function renderWarRoundPanelForContexts(env, activeGuildId, contexts) {
  try {
    const [context, factionData] = await firstWorkingContext(contexts, getUpdateFaction);
    const members = getMemberRows(factionData);
    const memberNames = new Map();
    for (const member of members) {
      const name = value(getValue(member, ["name", "username", "user_name", "player_name"])).trim();
      if (name) memberNames.set(normalizeName(name), name);
    }

    if (!isLiveWarRound(context)) {
      const storedPanel = await renderStoredWarRoundPanel(env, activeGuildId, context, members, memberNames);
      if (storedPanel) return storedPanel;
    }

    const [rankingContext, rankingData] = await firstWorkingContext(contexts, (c) => getRankings(c, "event_guild_war", "0"));
    const scoredRows = normalizeWarScoreRows(rankingData.rankings?.data || []);
    let enemyRankingData = null;
    try {
      [, enemyRankingData] = await firstWorkingContext(contexts, (c) => getRankings(c, "event_guild_war", "1"));
    } catch {
      enemyRankingData = null;
    }
    const enemyRows = normalizeWarScoreRows(enemyRankingData?.rankings?.data || []);
    const scoredNames = new Set(scoredRows.map((row) => normalizeName(row.name)));
    const missingNames = [...memberNames.entries()]
      .filter(([key]) => !scoredNames.has(key))
      .map(([, name]) => name)
      .sort((a, b) => a.localeCompare(b));

    const totalScore = scoredRows.reduce((sum, row) => sum + Number(row.stat || 0), 0);
    const scoredAverage = scoredRows.length ? totalScore / scoredRows.length : 0;
    const averageProjectedTotal = scoredAverage * members.length;
    const maxProjectedTotal = totalScore + missingNames.length * 1300;
    const matchupSummary = renderWarVsSummary(context.war_match, {
      name: context.guild_name,
      total: totalScore,
      scored: scoredRows.length,
      average: scoredAverage,
      averageTotal: averageProjectedTotal,
      maxTotal: maxProjectedTotal,
    }, enemyRows);
    const opponentName = getOpponentGuildName(context.war_match, context.guild_name);
    const tableId = `war-round-table-${activeGuildId}`;
    const missingTableId = `war-missing-table-${activeGuildId}`;

    let panel = `<div class="card">
  ${matchupSummary}
</div>
<div class="war-round-grid">
<div class="war-score-panel">
<table class="compact-table war-member-table" id="${escapeHtml(tableId)}">
  <tr><th class="number">Rank</th><th>${escapeHtml(context.guild_name)}</th><th class="number">Score</th><th class="war-member-vs">vs</th><th class="number">Score</th><th>${escapeHtml(opponentName)}</th><th class="number">Rank</th></tr>`;

    const rowCount = Math.max(scoredRows.length, enemyRows.length);
    for (let index = 0; index < rowCount; index += 1) {
      const ownRow = scoredRows[index] || {};
      const enemyRow = enemyRows[index] || {};
      panel += `<tr><td class="number">${escapeHtml(ownRow.rank || "")}</td><td>${escapeHtml(ownRow.name || "")}</td><td class="number">${escapeHtml(ownRow.stat ?? "")}</td><td class="war-member-vs"></td><td class="number">${escapeHtml(enemyRow.stat ?? "")}</td><td>${escapeHtml(enemyRow.name || "")}</td><td class="number">${escapeHtml(enemyRow.rank || "")}</td></tr>`;
    }
    panel += `</table></div>
<div class="missing-attacks-panel">
<table class="compact-table" id="${escapeHtml(missingTableId)}"><tr><th>Missing Players</th></tr>`;
    for (const name of missingNames) {
      panel += `<tr><td>${escapeHtml(name)}</td></tr>`;
    }
    return panel + "</table></div></div>";
  } catch (error) {
    return `<h1>${escapeHtml(contexts[0].guild_name)} - War Round</h1><p class="error">Could not load war round scores: ${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function renderStoredWarRoundPanel(env, activeGuildId, context, members, memberNames) {
  const warSnapshots = await readWarSnapshots(env, activeGuildId, context.ranking_index);
  const latestRound = latestCompletedWarRound(warSnapshots);
  if (!latestRound?.players) {
    return `<h1>${escapeHtml(context.guild_name)} - War Round</h1><div class="card"><p class="muted">No active war round right now.</p><p>No stored completed-round snapshot is available yet.</p></div>`;
  }

  const rows = Object.values(latestRound.players || {})
    .map((row) => ({ rank: Number(row.rank || 0), name: row.name, stat: Number(row.score || 0) }))
    .sort((a, b) => Number(b.stat || 0) - Number(a.stat || 0));
  rows.forEach((row, index) => { row.rank = Number(row.rank || 0) || index + 1; });
  const scoredNames = new Set(rows.filter((row) => Number(row.stat || 0) > 0).map((row) => normalizeName(row.name)));
  const missingNames = [...memberNames.entries()]
    .filter(([key]) => !scoredNames.has(key))
    .map(([, name]) => name)
    .sort((a, b) => a.localeCompare(b));
  const totalScore = rows.reduce((sum, row) => sum + Number(row.stat || 0), 0);
  const scoredCount = rows.filter((row) => Number(row.stat || 0) > 0).length;
  const average = scoredCount ? totalScore / scoredCount : 0;
  const averageTotal = average * members.length;
  const maxTotal = totalScore + missingNames.length * 1300;
  const tableId = `war-round-table-${activeGuildId}`;
  const missingTableId = `war-missing-table-${activeGuildId}`;

  let panel = `<div class="card">
  <p class="muted">No active war round right now. Showing stored Round ${escapeHtml(latestRound.round)} snapshot${latestRound.updated_at ? ` from ${escapeHtml(formatIso(latestRound.updated_at))}` : ""}.</p>
  <p><strong>Total:</strong> ${escapeHtml(totalScore)} &nbsp; <strong>Average:</strong> ${escapeHtml(formatNumber(average))} &nbsp; <strong>Average Total:</strong> ${escapeHtml(formatNumber(averageTotal))} &nbsp; <strong>Max Total:</strong> ${escapeHtml(formatNumber(maxTotal))} &nbsp; <strong>Players Attacked:</strong> ${escapeHtml(scoredCount)} / ${escapeHtml(members.length || 50)}</p>
</div>
<div class="war-round-grid">
<div class="war-score-panel">
<table class="compact-table war-member-table" id="${escapeHtml(tableId)}">
  <tr><th class="number">Rank</th><th>${escapeHtml(context.guild_name)}</th><th class="number">Score</th></tr>`;
  for (const row of rows.filter((row) => Number(row.stat || 0) > 0)) {
    panel += `<tr><td class="number">${escapeHtml(row.rank || "")}</td><td>${escapeHtml(row.name || "")}</td><td class="number">${escapeHtml(row.stat ?? "")}</td></tr>`;
  }
  panel += `</table></div>
<div class="missing-attacks-panel">
<table class="compact-table" id="${escapeHtml(missingTableId)}"><tr><th>Missing Players</th></tr>`;
  for (const name of missingNames) {
    panel += `<tr><td>${escapeHtml(name)}</td></tr>`;
  }
  return panel + "</table></div></div>";
}

async function renderWarHistory(request, env, guildId, url) {
  return cached(request, `war-history:${guildId || "first"}`, 60, async () => {
    const { guilds, errors } = await discoverGuilds(withoutRefresh(request), env);
    const activeGuildId = selectedOrFirstGuild(guilds, guildId);
    if (!Object.keys(guilds).length) return page("War History", `<h1>War History</h1><div class='card'>No guilds discovered.</div>${discoveryErrors(errors)}`, "war-history", guilds, url);

    const buttons = [];
    const panels = [];

    for (const [currentGuildId, contexts] of orderedGuildEntries(guilds)) {
      const guildName = contexts[0].guild_name;
      const activeClass = currentGuildId === activeGuildId ? " active" : "";
      buttons.push(`<a class="guild-link${activeClass}" href="#" data-guild="${escapeHtml(currentGuildId)}">${escapeHtml(guildName)}</a>`);

      try {
        const [context, warStatus] = await firstWorkingContext(contexts, getGuildWarStatus);
        let rows = getWarHistoryRows(warStatus, context.guild_name);
        if (!rows.length) {
          const [, data] = await firstWorkingContext(contexts, (c) => getRankings(c, "event_guild_war", "2"));
          rows = getWarHistoryFallbackRows(data.rankings?.data || [], context.guild_name);
        }
        let panel = `<div id="guild-panel-${escapeHtml(currentGuildId)}" class="guild-panel${currentGuildId === activeGuildId ? " active" : ""}">
<h1>${escapeHtml(context.guild_name)} - War History</h1>
<table class="compact-table">
  <tr><th class="number">Round</th><th>${escapeHtml(context.guild_name)}</th><th class="number">Score</th><th>Enemy Guild</th><th class="number">Enemy Score</th><th class="number">Difference</th><th>Result</th></tr>`;

        for (const row of rows) {
          const difference = row.own_score !== "" && row.enemy_score !== "" ? Number(row.own_score) - Number(row.enemy_score) : "";
          panel += `<tr><td class="number">${escapeHtml(row.round || "")}</td><td>${escapeHtml(context.guild_name)}</td><td class="number">${escapeHtml(row.own_score)}</td><td>${escapeHtml(row.enemy_name || "")}</td><td class="number">${escapeHtml(row.enemy_score)}</td><td class="number">${escapeHtml(difference === "" ? "" : formatSignedNumber(difference))}</td><td>${escapeHtml(row.result || "")}</td></tr>`;
        }
        panel += "</table></div>";
        panels.push(panel);
      } catch (error) {
        panels.push(`<div id="guild-panel-${escapeHtml(currentGuildId)}" class="guild-panel${currentGuildId === activeGuildId ? " active" : ""}"><h1>${escapeHtml(guildName)} - War History</h1><p class="error">Could not load war history: ${escapeHtml(error.message || String(error))}</p></div>`);
      }
    }

    const body = `<div class="guild-links" id="guild-tabs">${buttons.join("")}</div>${panels.join("")}`;
    return page("War History", body, "war-history", guilds, withGuild(url, activeGuildId));
  });
}

async function renderEventHistory(request, env, url) {
  const { guilds, errors } = await discoverGuilds(withoutRefresh(request), env);
  const trackedGuilds = orderedGuildEntries(guilds).map(([guildId, contexts]) => ({
    guild_id: guildId,
    guild_name: contexts[0]?.guild_name || `Guild ${guildId}`,
  }));
  const currentBgeNames = Object.values(guilds)
    .flat()
    .find((context) => context.bge_names?.length)?.bge_names || [];
  const history = await readEventHistory(env);
  const clashEntries = eventHistoryEntries(history, "guild_clash");
  const warEntries = eventHistoryEntries(history, "guild_war");
  const activeType = url.searchParams.get("type") === "guild_war" ? "guild_war" : "guild_clash";

  const body = `<div class="guild-links" id="event-history-tabs">
  <a class="guild-link${activeType === "guild_clash" ? " active" : ""}" href="#" data-event-history-tab="guild_clash">Guild Clash</a>
  <a class="guild-link${activeType === "guild_war" ? " active" : ""}" href="#" data-event-history-tab="guild_war">Guild War</a>
</div>
${renderEventHistoryPanel("guild_clash", "Guild Clash", clashEntries, trackedGuilds, activeType === "guild_clash", currentBgeNames)}
${renderEventHistoryPanel("guild_war", "Guild War", warEntries, trackedGuilds, activeType === "guild_war", currentBgeNames)}
${discoveryErrors(errors)}
<script>
(function(){
  document.querySelectorAll('[data-event-history-tab]').forEach(function(link){
    link.addEventListener('click', function(event){
      event.preventDefault();
      var type=link.getAttribute('data-event-history-tab');
      document.querySelectorAll('[data-event-history-tab]').forEach(function(item){item.classList.remove('active');});
      document.querySelectorAll('[data-event-history-panel]').forEach(function(panel){panel.classList.remove('active');});
      link.classList.add('active');
      var panel=document.querySelector('[data-event-history-panel="'+type+'"]');
      if(panel) panel.classList.add('active');
      var url=new URL(window.location.href);
      url.searchParams.set('type', type);
      history.replaceState(null,'',url.toString());
    });
  });
})();
</script>`;
  return page("Event History", body, "event-history", guilds, url);
}

function renderEventHistoryPanel(type, title, entries, trackedGuilds, active, fallbackBgeNames = []) {
  const panelClass = active ? " guild-panel active" : " guild-panel";
  if (!entries.length) {
    return `<div class="${panelClass}" data-event-history-panel="${escapeHtml(type)}"><h1>${escapeHtml(title)} History</h1><div class="card"><p class="muted">No saved ${escapeHtml(title)} history yet.</p><p>Finished events will be saved automatically after weekend events.</p></div></div>`;
  }

  const trackedNames = new Set(trackedGuilds.map((guild) => normalizeName(guild.guild_name)).filter(Boolean));
  const metricsByGuild = eventHistoryMetricsByGuild(entries, trackedNames);
  let body = `<div class="${panelClass}" data-event-history-panel="${escapeHtml(type)}"><h1>${escapeHtml(title)} History</h1><div class="card"><p class="muted">Newest event is shown on the left. Family guilds are highlighted like Global Rank. Green marks that guild's best saved event, red marks its worst saved event.</p></div><div class="event-history-scroll"><table class="event-history-compare-table"><tr><th class="number">Rank</th>`;
  for (const entry of entries) {
    body += `<th><div>${escapeHtml(entry.event_name || title)}</div><div class="muted-small">${escapeHtml(formatEventHistoryDuration(entry))}</div><div class="muted-small">BGE: ${escapeHtml(eventHistoryBgeText(entry, fallbackBgeNames))}</div></th>`;
  }
  body += "</tr>";

  for (let rank = 1; rank <= 50; rank += 1) {
    body += `<tr><td class="number">${rank}</td>`;
    for (const entry of entries) {
      const rows = eventHistoryRowsWithGaps(entry).filter((row) => Number(row.rank || 0) === rank);
      body += eventHistoryRankCell(rows, entry, trackedNames, metricsByGuild);
    }
    body += "</tr>";
  }

  return body + "</table></div></div>";
}

function eventHistoryEntries(history, type) {
  return (history?.entries || [])
    .filter((entry) => entry.type === type)
    .sort((a, b) => timestampFromIso(b.saved_at || b.event_date) - timestampFromIso(a.saved_at || a.event_date));
}

function eventHistoryRowForGuild(entry, guildName) {
  const key = normalizeName(guildName);
  return (entry.rows || []).find((row) => normalizeName(row.name) === key) || null;
}

function eventHistoryRowsWithGaps(entry) {
  const rows = [...(entry.rows || [])]
    .filter((row) => row?.name)
    .sort((a, b) => Number(a.rank || 999999) - Number(b.rank || 999999) || Number(b.stat || 0) - Number(a.stat || 0));
  return rows.map((row) => {
    const rank = Number(row.rank || 0);
    const previousHigher = rows
      .filter((candidate) => Number(candidate.rank || 0) > 0 && Number(candidate.rank || 0) < rank)
      .sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0))[0];
    const gap = previousHigher ? Math.max(0, Number(previousHigher.stat || 0) - Number(row.stat || 0)) : 0;
    return {
      ...row,
      gap_to_next: rank > 1 ? gap : "",
    };
  });
}

function eventHistoryMetricsByGuild(entries, trackedNames) {
  const metricsByGuild = new Map();
  for (const entry of entries) {
    const rows = eventHistoryRowsWithGaps(entry);
    for (const row of rows) {
      const key = normalizeName(row.name);
      if (!trackedNames.has(key)) continue;
      if (!metricsByGuild.has(key)) metricsByGuild.set(key, []);
      metricsByGuild.get(key).push({
        event_id: String(entry.event_id || ""),
        rank: Number(row.rank || 999999),
        gap: Number(row.gap_to_next || 0),
      });
    }
  }
  return metricsByGuild;
}

function eventHistoryCompareMetric(a, b) {
  return Number(a.rank || 999999) - Number(b.rank || 999999) || Number(a.gap || 0) - Number(b.gap || 0);
}

function eventHistoryHighlightClass(metrics, entry) {
  if (!metrics || metrics.length < 2) return "";
  const current = metrics.find((metric) => String(metric.event_id) === String(entry.event_id || ""));
  if (!current) return "";
  const best = [...metrics].sort(eventHistoryCompareMetric)[0];
  const worst = [...metrics].sort((a, b) => eventHistoryCompareMetric(b, a))[0];
  if (eventHistoryCompareMetric(current, best) === 0) return "event-best";
  if (eventHistoryCompareMetric(current, worst) === 0) return "event-worst";
  return "";
}

function eventHistoryRankCell(rows, entry, trackedNames, metricsByGuild) {
  if (!rows.length) return "<td></td>";
  const classes = [];
  const lines = rows.map((row) => {
    const key = normalizeName(row.name);
    if (trackedNames.has(key)) {
      classes.push("tool-guild-row");
      const highlight = eventHistoryHighlightClass(metricsByGuild.get(key), entry);
      if (highlight) classes.push(highlight);
    }
    return `<div><span>${escapeHtml(row.name || "")}</span> <span class="muted-small">${escapeHtml(row.stat ?? "")}</span></div>`;
  });
  const uniqueClasses = [...new Set(classes)];
  return `<td${uniqueClasses.length ? ` class="${uniqueClasses.join(" ")}"` : ""}>${lines.join("")}</td>`;
}

function eventHistoryBgeText(entry, fallbackBgeNames = []) {
  const names = entry.bge_names?.length ? entry.bge_names : fallbackBgeNames;
  const tribes = names.map(bgeNameToTribe).filter(Boolean);
  return tribes.length ? [...new Set(tribes)].join(", ") : names?.length ? names.join(", ") : "Unknown";
}

function bgeNameToTribe(name) {
  const text = String(name || "").toLowerCase();
  const exact = {
    "adaptive swarm": "Insect",
    "deep water shelter": "Seafolk",
    "beast supremacy": "Beast",
  };
  if (exact[text]) return exact[text];
  if (text.includes("insect") || text.includes("swarm")) return "Insect";
  if (text.includes("seafolk") || text.includes("water") || text.includes("sea")) return "Seafolk";
  if (text.includes("beast")) return "Beast";
  if (text.includes("dragon")) return "Dragon";
  if (text.includes("goblin")) return "Goblin";
  if (text.includes("wyld")) return "Wyld";
  if (text.includes("undead") || text.includes("necrom") || text.includes("lich")) return "Undead";
  if (text.includes("mech")) return "Mechanical";
  if (text.includes("element")) return "Elemental";
  return "";
}

function formatEventHistoryDuration(entry) {
  const anchor = new Date(entry?.event_date || entry?.saved_at || "");
  if (Number.isNaN(anchor.getTime())) return "";
  const day = anchor.getUTCDay();
  const friday = new Date(Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    anchor.getUTCDate() - ((day + 2) % 7),
    17,
    0,
    0,
  ));
  const monday = new Date(friday.getTime() + 3 * 24 * 60 * 60 * 1000);
  return `${formatEventHistoryShortDate(friday)} - ${formatEventHistoryShortDate(monday)} (${formatEventHistoryUtcTime(friday)})`;
}

function formatEventHistoryShortDate(date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

function formatEventHistoryUtcTime(date) {
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

function getWarHistoryRows(warStatus, guildName) {
  const matches = Array.isArray(warStatus.guild_war_matches) ? warStatus.guild_war_matches : [];
  return matches.map((match, index) => normalizeWarHistoryMatch(match, guildName, index + 1)).filter(Boolean);
}

function getDisplayWarRounds(context, warSnapshots) {
  const rounds = new Map();
  for (const round of warSnapshots?.rounds || []) {
    const roundNumber = Number(round.round || 0);
    if (!roundNumber) continue;
    rounds.set(roundNumber, {
      round: roundNumber,
      enemy_name: round.enemy_name || "",
      players: round.players || {},
    });
  }

  const historyMatches = Array.isArray(context.war_history_matches) ? context.war_history_matches : [];
  historyMatches.forEach((match, index) => {
    const row = normalizeWarHistoryMatch(match, context.guild_name, index + 1);
    const roundNumber = Number(row?.round || index + 1);
    if (!roundNumber) return;
    const existing = rounds.get(roundNumber);
    if (existing) {
      if (!existing.enemy_name) existing.enemy_name = row?.enemy_name || "";
      return;
    }
    rounds.set(roundNumber, {
      round: roundNumber,
      enemy_name: row?.enemy_name || "",
      players: null,
    });
  });

  if (context.war_match) {
    const currentRound = Number(context.war_history_count || historyMatches.length || 0) + 1;
    if (!rounds.has(currentRound)) {
      rounds.set(currentRound, {
        round: currentRound,
        enemy_name: getOpponentGuildName(context.war_match, context.guild_name),
        players: null,
      });
    } else {
      const existing = rounds.get(currentRound);
      if (!existing.enemy_name) existing.enemy_name = getOpponentGuildName(context.war_match, context.guild_name);
    }
  }

  return [...rounds.values()].sort((a, b) => Number(a.round || 0) - Number(b.round || 0));
}

function latestCompletedWarRound(warSnapshots) {
  const rounds = Array.isArray(warSnapshots?.rounds) ? warSnapshots.rounds : [];
  return rounds
    .filter((round) => round?.players && Object.keys(round.players || {}).length)
    .sort((a, b) => Number(b.round || 0) - Number(a.round || 0))[0] || null;
}

function isLiveWarRound(context) {
  if (context.war_active !== true) return false;
  const time = Number(context.war_server_time || Math.floor(Date.now() / 1000));
  if (!Number.isFinite(time) || time <= 0) return true;
  const secondsInDay = ((time % 86400) + 86400) % 86400;
  const starts = [60 * 60, 9 * 60 * 60, 17 * 60 * 60];
  return starts.some((start) => secondsInDay >= start + 30 * 60 && secondsInDay < start + 8 * 60 * 60);
}

function normalizeWarHistoryMatch(match, guildName, fallbackRound) {
  const usName = value(getValue(match, ["us_name", "guild_name", "our_name"]));
  const themName = value(getValue(match, ["them_name", "enemy_name", "opponent_name", "name"]));
  const ownIsUs = !themName || normalizeName(usName) === normalizeName(guildName);
  const ownScore = ownIsUs
    ? value(getValue(match, ["us_kills", "us_score", "our_score", "own_score", "score"]))
    : value(getValue(match, ["them_kills", "them_score", "enemy_score", "opponent_score"]));
  const enemyScore = ownIsUs
    ? value(getValue(match, ["them_kills", "them_score", "enemy_score", "opponent_score"]))
    : value(getValue(match, ["us_kills", "us_score", "our_score", "own_score", "score"]));
  const enemyName = ownIsUs ? themName : usName;
  if (!ownScore && !enemyScore && !enemyName) return null;
  return {
    round: value(getValue(match, ["rank", "round", "match", "match_number"])) || fallbackRound,
    enemy_name: enemyName,
    own_score: ownScore,
    enemy_score: enemyScore,
    result: formatWarResult(value(getValue(match, ["desc", "result", "outcome"])) || resultFromScores(ownScore, enemyScore)),
  };
}

function getWarHistoryFallbackRows(rows, guildName) {
  return (rows || []).map((row) => ({
    round: value(row.rank),
    enemy_name: value(row.name),
    own_score: "",
    enemy_score: "",
    result: formatWarResult(value(row.desc || row.result)),
    note: value(row.stat),
  }));
}

function resultFromScores(ownScore, enemyScore) {
  const own = Number(ownScore);
  const enemy = Number(enemyScore);
  if (!Number.isFinite(own) || !Number.isFinite(enemy)) return "";
  if (own > enemy) return "W";
  if (own < enemy) return "L";
  return "T";
}

function formatWarResult(input) {
  const text = value(input).trim();
  const key = text.toLowerCase();
  if (key === "1") return "Win";
  if (key === "2") return "Loss";
  if (key === "0") return "Tie";
  if (key === "w" || key === "win" || key === "won") return "Win";
  if (key === "l" || key === "loss" || key === "lost") return "Loss";
  if (key === "t" || key === "tie" || key === "draw") return "Tie";
  return text;
}

async function renderLastOnline(request, env, guildId, url) {
  return renderSelectedGuildPage(request, env, guildId, url, "online", "Last Online", 60, async (context) => {
    const data = await getUpdateFaction(context);
    const rows = getMemberRows(data);
    let body = `<h1>${escapeHtml(context.guild_name)} - Last Online</h1><table class="compact-table" id="last-online-table"><tr><th>Name</th><th>Last Online</th><th class="number">Level</th></tr>`;
    for (const row of rows) {
      const lastSeen = getValue(row, ["last_update_time", "last_online", "last_login"]);
      body += `<tr><td>${escapeHtml(getValue(row, ["name", "username", "user_name", "player_name"]))}</td><td><span class="age-badge ${lastOnlineClass(lastSeen)}">${escapeHtml(timeAgo(lastSeen))}</span></td><td class="number">${escapeHtml(getValue(row, ["level", "player_level"]))}</td></tr>`;
    }
    return body + "</table>";
  });
}

async function renderActivity(request, env, guildId, url) {
  return renderSelectedGuildPage(request, env, guildId, url, "activity", "Guild Activity", 60, async (context) => {
    const data = await getGuildFeed(context);
    const rows = getFeedRows(data);
    let body = `<h1>${escapeHtml(context.guild_name)} - Guild Activity</h1><table id="activity-table"><tr><th>Time</th><th>Player</th><th>Activity</th></tr>`;
    for (const row of rows) {
      body += `<tr><td>${escapeHtml(formatTime(getValue(row, ["time", "timestamp", "date", "created_at"])))}</td><td>${escapeHtml(getValue(row, ["name", "username", "user_name", "player_name"]))}</td><td class="message">${escapeHtml(describeActivity(row))}</td></tr>`;
    }
    return body + "</table>";
  });
}

async function renderChat(request, env, guildId, url) {
  return renderSelectedGuildPage(request, env, guildId, url, "chat", "Guild Chat", 60, async (context) => {
    const data = await getGuildChat(context);
    const rows = getChatRows(data);
    let body = `<h1>${escapeHtml(context.guild_name)} - Guild Chat</h1><table id="chat-table"><tr><th>Time</th><th>Player</th><th>Message</th></tr>`;
    for (const row of rows) {
      body += `<tr><td>${escapeHtml(formatTime(getValue(row, ["gametime", "time", "timestamp", "date", "created_at"])))}</td><td>${escapeHtml(getValue(row, ["name", "username", "user_name", "player_name"]))}</td><td class="message">${escapeHtml(getValue(row, ["message", "text", "chat"]))}</td></tr>`;
    }
    return body + "</table>";
  });
}

async function renderDeckHashes(request, env, guildId, url) {
  const { guilds, errors } = await discoverGuilds(request, env);
  const activeGuildId = selectedOrFirstGuild(guilds, guildId);
  const key = url.searchParams.get("key") || "";
  if (!env.DECK_CACHE) {
    return page(
      "Deck Hashes",
      `<h1>Deck Hashes</h1><div class="card"><p class="error">DECK_CACHE KV binding is not configured yet.</p><p>Create the KV namespace, add it to wrangler.toml, then deploy again.</p></div>`,
      "decks",
      guilds,
      url,
    );
  }
  if (!guilds[activeGuildId]) return page("Guild Not Found", `<h1>Guild not found</h1><p>No discovered guild with that ID.</p>${discoveryErrors(errors)}`, "decks", guilds, url);

  const buttons = [];
  const panels = [];
  const deckCacheMap = {};
  const cacheByGuildId = await readDeckCachesForGuilds(env, guilds);
  const cachedRowsByUserId = buildCachedRowsByUserId(cacheByGuildId);

  for (const [currentGuildId, contexts] of orderedGuildEntries(guilds)) {
    const guildName = contexts[0].guild_name;
    const cache = cacheByGuildId[currentGuildId] || null;
    const rows = await currentGuildDeckRows(contexts, cache, cachedRowsByUserId);
    deckCacheMap[currentGuildId] = { ...(cache || {}), rows };
    const activeClass = currentGuildId === activeGuildId ? " active" : "";
    const updated = cache?.updated_at ? formatIso(cache.updated_at) : "Never";
    const offenceRows = rows.filter((row) => row.offence_hash);
    const defenceRows = rows.filter((row) => row.defence_hash);
    const activeRows = rows.filter((row) => row.active_hash);

    buttons.push(`<a class="guild-link${activeClass}" href="#" data-guild="${escapeHtml(currentGuildId)}">${escapeHtml(guildName)}</a>`);

    let panel = `<div id="guild-panel-${escapeHtml(currentGuildId)}" class="guild-panel${currentGuildId === activeGuildId ? " active" : ""}">
<h1>${escapeHtml(guildName)} - Deck Hashes</h1>
<div class="card">
  <div class="muted" id="deck-status-${escapeHtml(currentGuildId)}">Last updated: ${escapeHtml(updated)}${rows.length ? ` (${offenceRows.length} offence, ${defenceRows.length} defence / ${rows.length} players)` : ""}</div>
  <button class="copy-button" type="button" data-copy-guild="${escapeHtml(currentGuildId)}" data-copy-kind="offence"${offenceRows.length ? "" : " disabled"}>Copy Offence</button>
  <button class="copy-button" type="button" data-copy-guild="${escapeHtml(currentGuildId)}" data-copy-kind="defence"${defenceRows.length ? "" : " disabled"}>Copy Defence</button>
  <button class="copy-button" type="button" data-copy-guild="${escapeHtml(currentGuildId)}" data-copy-kind="active"${activeRows.length ? "" : " disabled"}>Copy Active</button>
  <button class="copy-button" type="button" data-refresh-guild="${escapeHtml(currentGuildId)}">Refresh Guild</button>
  <button class="copy-button" type="button" data-clear-defence="${escapeHtml(currentGuildId)}">Clear Defence Decks</button>
</div>`;

    if (!rows.length) {
      panel += `<div class="card"><p>No current guild members found. Try refreshing the page.</p></div>`;
    } else {
      panel += `<input class="filter-input" data-table-filter="deck-table-${escapeHtml(currentGuildId)}" placeholder="Search deck hashes"><table id="deck-table-${escapeHtml(currentGuildId)}">
  <tr><th>Name</th><th>Offence Hash</th><th>Defence Hash</th><th>Active Hash</th><th>Defence Source</th><th>Updated (UTC)</th><th></th></tr>`;
      for (const row of rows) {
        const updatedAt = row.offence_updated_at || row.defence_updated_at || row.updated_at;
        panel += `<tr>
  <td>${escapeHtml(row.name)}</td>
  <td class="hash-cell">${escapeHtml(row.offence_hash || row.error || "")}</td>
  <td class="hash-cell">${escapeHtml(row.defence_hash || "")}</td>
  <td class="hash-cell">${escapeHtml(row.active_hash || "")}</td>
  <td>${escapeHtml(row.defence_source || "")}</td>
  <td>${escapeHtml(updatedAt ? formatIso(updatedAt) : "")}</td>
  <td><button class="copy-button" type="button" data-refresh-player="${escapeHtml(currentGuildId)}" data-user-id="${escapeHtml(row.user_id)}">Refresh Player</button></td>
</tr>`;
      }
      panel += "</table>";
    }

    panel += "</div>";
    panels.push(panel);
  }

  const body = `<div class="guild-links" id="guild-tabs">${buttons.join("")}</div>${panels.join("")}
<script>
(function(){
  var deckCaches = ${JSON.stringify(deckCacheMap)};
  var key = ${JSON.stringify(key)};
  var batchLimit = 8;
  function escapeText(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function(ch) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function simText(guild, kind) {
    return ((deckCaches[guild] && deckCaches[guild].rows) || [])
      .map(function(row) {
        var hash = kind === 'active' ? row.active_hash : kind === 'defence' ? row.defence_hash : (row.offence_hash || row.hash);
        return { name: row.name, hash: hash };
      })
      .filter(function(row) { return row.hash; })
      .map(function(row) { return JSON.stringify(row.name) + ' : ' + JSON.stringify(row.hash); })
      .join('\\n');
  }
  document.querySelectorAll('[data-copy-guild]').forEach(function(button) {
    button.addEventListener('click', async function() {
      var guild = button.getAttribute('data-copy-guild');
      var kind = button.getAttribute('data-copy-kind') || 'offence';
      var label = kind === 'active' ? 'Copy Active' : kind === 'defence' ? 'Copy Defence' : 'Copy Offence';
      try {
        await navigator.clipboard.writeText(simText(guild, kind));
        button.textContent = 'Copied';
        setTimeout(function() { button.textContent = label; }, 1500);
      } catch (error) {
        button.textContent = 'Copy failed';
        setTimeout(function() { button.textContent = label; }, 1500);
      }
    });
  });
  document.querySelectorAll('[data-clear-defence]').forEach(function(button) {
    button.addEventListener('click', async function() {
      var guild = button.getAttribute('data-clear-defence');
      if (!confirm('Clear saved defence decks for this guild? Offence hashes stay saved.')) return;
      button.disabled = true;
      button.textContent = 'Clearing...';
      var params = new URLSearchParams({ guild: guild });
      if (key) params.set('key', key);
      var response = await fetch('/api/decks/clear-defence?' + params.toString(), { method: 'POST' });
      var data = await response.json();
      if (!response.ok || data.error) {
        button.textContent = 'Failed';
        alert(data.error || 'Could not clear defence decks');
        return;
      }
      window.location.href = '/decks?guild=' + encodeURIComponent(guild) + (key ? '&key=' + encodeURIComponent(key) : '');
    });
  });
  document.querySelectorAll('[data-refresh-player]').forEach(function(button) {
    button.addEventListener('click', async function() {
      var guild = button.getAttribute('data-refresh-player');
      var userId = button.getAttribute('data-user-id');
      button.disabled = true;
      button.textContent = 'Refreshing...';
      var params = new URLSearchParams({ guild: guild, user_id: userId });
      if (key) params.set('key', key);
      var response = await fetch('/api/decks/refresh-player?' + params.toString(), { method: 'POST' });
      var data = await response.json();
      if (!response.ok || data.error) {
        button.textContent = 'Failed';
        alert(data.error || 'Could not refresh player');
        return;
      }
      window.location.href = '/decks?guild=' + encodeURIComponent(guild) + (key ? '&key=' + encodeURIComponent(key) : '');
    });
  });
  document.querySelectorAll('[data-refresh-guild]').forEach(function(button) {
    button.addEventListener('click', async function() {
      var guild = button.getAttribute('data-refresh-guild');
      var status = document.getElementById('deck-status-' + guild);
      var offset = 0;
      var total = null;
      button.disabled = true;
      button.textContent = 'Refreshing...';
    try {
        while (total === null || offset < total) {
          var params = new URLSearchParams({ guild: guild, offset: String(offset), limit: String(batchLimit), write: '1' });
          if (key) params.set('key', key);
          var response = await fetch('/api/decks?' + params.toString());
          var data = await response.json();
          if (!response.ok || data.error) throw new Error(data.error || 'Could not refresh guild');
          total = data.total;
          offset += data.rows.length;
          status.textContent = 'Refreshing: ' + offset + ' / ' + total;
          if (!data.rows.length) break;
        }
        window.location.href = '/decks?guild=' + encodeURIComponent(guild) + (key ? '&key=' + encodeURIComponent(key) : '');
    } catch (error) {
        button.textContent = 'Failed';
        status.innerHTML = '<span class="error">' + escapeText(error.message) + '</span>';
    }
    });
  });
})();
</script>`;

  return page("Deck Hashes", body, "decks", guilds, withGuild(url, activeGuildId));
}

async function renderDeckHashBatch(request, env, guildId, url) {
  if (!env.DECK_CACHE) return { error: "DECK_CACHE KV binding is not configured" };
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const limit = Math.min(8, Math.max(1, Number(url.searchParams.get("limit") || 8)));
  const write = url.searchParams.get("write") === "1";
  const reset = url.searchParams.get("reset") === "1";
  const { guilds } = await discoverGuilds(request, env);
  const activeGuildId = selectedOrFirstGuild(guilds, guildId);
  const contexts = guilds[activeGuildId];
  if (!contexts) return { error: "Guild not found", rows: [], total: 0 };
  const fallbackRowsByUserId = buildCachedRowsByUserId(await readDeckCachesForGuilds(env, guilds));

  const [context, data] = await firstWorkingContext(contexts, getUpdateFaction);
  const members = getMemberRows(data).sort((a, b) => String(getValue(a, ["name", "username", "user_name", "player_name"])).localeCompare(String(getValue(b, ["name", "username", "user_name", "player_name"]))));
  const batch = members.slice(offset, offset + limit);
  const rows = [];
  for (const row of batch) {
    const name = String(getValue(row, ["name", "username", "user_name", "player_name"]));
    const targetUserId = String(getValue(row, ["user_id", "id", "uid"]));
    try {
      const deck = await getBestDeckHash(context, targetUserId);
      rows.push(deckCacheRow(name, targetUserId, deck));
    } catch (error) {
      rows.push(deckCacheErrorRow(name, targetUserId, error));
    }
    await sleep(100);
  }

  if (write) {
    await mergeDeckCacheRows(env, activeGuildId, context.guild_name, rows, { reset, total: members.length, fallbackRowsByUserId });
  }

  return { guild: activeGuildId, total: members.length, offset, limit, rows };
}

async function refreshPlayerDeckCache(request, env, guildId, url) {
  if (!env.DECK_CACHE) return { error: "DECK_CACHE KV binding is not configured" };
  const userId = url.searchParams.get("user_id") || "";
  if (!userId) return { error: "Missing user_id" };

  const { guilds } = await discoverGuilds(request, env);
  const activeGuildId = selectedOrFirstGuild(guilds, guildId);
  const contexts = guilds[activeGuildId];
  if (!contexts) return { error: "Guild not found" };
  const fallbackRowsByUserId = buildCachedRowsByUserId(await readDeckCachesForGuilds(env, guilds));

  const [context, data] = await firstWorkingContext(contexts, getUpdateFaction);
  const members = getMemberRows(data);
  const member = members.find((row) => String(getValue(row, ["user_id", "id", "uid"])) === String(userId));
  if (!member) return { error: "Player not found in guild" };

  const name = String(getValue(member, ["name", "username", "user_name", "player_name"]));
  let row;
  try {
    const deck = await getBestDeckHash(context, userId);
    row = deckCacheRow(name, userId, deck);
  } catch (error) {
    row = deckCacheErrorRow(name, userId, error);
  }

  await mergeDeckCacheRows(env, activeGuildId, context.guild_name, [row], { total: members.length, fallbackRowsByUserId });
  return { guild: activeGuildId, row };
}

async function clearDefenceDeckCache(request, env, guildId) {
  if (!env.DECK_CACHE) return { error: "DECK_CACHE KV binding is not configured" };
  const { guilds } = await discoverGuilds(request, env);
  const activeGuildId = selectedOrFirstGuild(guilds, guildId);
  const contexts = guilds[activeGuildId];
  if (!contexts) return { error: "Guild not found" };
  const [, data] = await firstWorkingContext(contexts, getUpdateFaction);
  const currentMemberIds = new Set(getMemberRows(data).map((row) => String(getValue(row, ["user_id", "id", "uid"]))));

  const cache = await readDeckCache(env, activeGuildId);
  if (!cache) return { guild: activeGuildId, cleared: 0 };

  let cleared = 0;
  const rows = (cache.rows || []).map((row) => {
    const next = normalizeDeckCacheRow(row);
    if (!currentMemberIds.has(String(next.user_id))) return next;
    if (next.defence_hash || next.defence_source || next.defence_deck_name) cleared += 1;
    next.defence_hash = next.offence_hash || "";
    next.defence_deck_name = next.offence_deck_name || "";
    next.defence_source = next.offence_hash ? "Fallback offence" : "";
    next.defence_updated_at = next.offence_hash ? new Date().toISOString() : "";
    return next;
  });

  await writeDeckCache(env, activeGuildId, {
    ...cache,
    rows,
    updated_at: new Date().toISOString(),
  });
  return { guild: activeGuildId, cleared };
}

async function refreshGuildDeckCache(request, env, guildId, url) {
  if (!env.DECK_CACHE) return { error: "DECK_CACHE KV binding is not configured" };
  const { guilds } = await discoverGuilds(request, env);
  const activeGuildId = selectedOrFirstGuild(guilds, guildId);
  const contexts = guilds[activeGuildId];
  if (!contexts) return { error: "Guild not found" };

  let offset = 0;
  let total = null;
  const limit = 8;
  while (total === null || offset < total) {
    const batchUrl = new URL(url.toString());
    batchUrl.searchParams.set("guild", activeGuildId);
    batchUrl.searchParams.set("offset", String(offset));
    batchUrl.searchParams.set("limit", String(limit));
    batchUrl.searchParams.set("write", "1");
    const data = await renderDeckHashBatch(request, env, activeGuildId, batchUrl);
    if (data.error) return data;
    total = data.total;
    offset += data.rows.length;
    if (!data.rows.length) break;
  }

  return { guild: activeGuildId, total, refreshed: offset };
}

async function refreshAllGuildDeckCaches(request, env) {
  if (!env.DECK_CACHE) return;
  const { guilds } = await discoverGuilds(request, env);
  for (const guildId of orderedGuildIds(guilds)) {
    const url = new URL(request.url);
    url.searchParams.set("guild", guildId);
    await refreshGuildDeckCache(request, env, guildId, url);
  }
}

async function runScheduledDeckRefresh(request, env, event) {
  if (!env.DECK_CACHE) return;

  const now = new Date(event.scheduledTime || Date.now());
  const date = now.toISOString().slice(0, 10);
  const minute = now.getUTCMinutes();
  let state = await readAutoRefreshState(env);
  const hasNoWorkState = state
    && state.date === date
    && !state.queue?.length
    && !state.completed?.length;

  if (minute === 0 || !state || state.date !== date || hasNoWorkState) {
    const { guilds } = await discoverGuilds(request, env);
    const autoRefreshGuildIds = orderedGuildEntries(guilds)
      .filter(([, contexts]) => contexts.some((context) => context.auto_refresh === true))
      .map(([guildId]) => guildId);
    state = {
      date,
      started_at: now.toISOString(),
      updated_at: now.toISOString(),
      queue: autoRefreshGuildIds.map((guildId) => ({ guild_id: guildId, offset: 0 })),
      completed: [],
      errors: [],
    };
  }

  const task = state.queue.shift();
  if (!task) {
    state.updated_at = new Date().toISOString();
    await writeAutoRefreshState(env, state);
    return;
  }

  try {
    const batchUrl = new URL(request.url);
    batchUrl.searchParams.set("guild", task.guild_id);
    batchUrl.searchParams.set("offset", String(task.offset));
    batchUrl.searchParams.set("limit", "8");
    batchUrl.searchParams.set("write", "1");
    const data = await renderDeckHashBatch(request, env, task.guild_id, batchUrl);
    if (data.error) throw new Error(data.error);

    const nextOffset = task.offset + data.rows.length;
    if (nextOffset < data.total && data.rows.length) {
      state.queue.push({ guild_id: task.guild_id, offset: nextOffset });
    } else {
      state.completed.push(task.guild_id);
    }
  } catch (error) {
    state.errors.push({ guild_id: task.guild_id, offset: task.offset, error: error.message || String(error), time: new Date().toISOString() });
  }

  state.updated_at = new Date().toISOString();
  await writeAutoRefreshState(env, state);
}

function eventHistoryKey() {
  return "event-history:v1";
}

async function readEventHistory(env) {
  if (!env.DECK_CACHE) return { entries: [] };
  const text = await env.DECK_CACHE.get(eventHistoryKey());
  if (!text) return { entries: [] };
  try {
    const parsed = JSON.parse(text);
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

async function writeEventHistory(env, history) {
  if (!env.DECK_CACHE) return;
  await env.DECK_CACHE.put(eventHistoryKey(), JSON.stringify({
    entries: Array.isArray(history?.entries) ? history.entries.slice(0, 80) : [],
    updated_at: new Date().toISOString(),
  }));
}

async function saveCurrentEventHistory(request, env, event) {
  if (!env.DECK_CACHE) return;
  const refreshRequest = new Request("https://scheduled.local/?refresh=1");
  const { guilds } = await discoverGuilds(refreshRequest, env);
  const contexts = Object.values(guilds).flat();
  const candidates = contexts.filter((context) => historyEventType(context) && context.ranking_index);
  if (!candidates.length) return;

  const grouped = new Map();
  for (const context of candidates) {
    const key = `${historyEventType(context)}:${context.ranking_index}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(context);
  }

  const history = await readEventHistory(env);
  for (const groupContexts of grouped.values()) {
    const entry = await buildEventHistoryEntry(groupContexts, event);
    if (!entry?.rows?.length) continue;
    history.entries = [
      entry,
      ...history.entries.filter((old) => !(old.type === entry.type && String(old.event_id) === String(entry.event_id))),
    ];
  }
  await writeEventHistory(env, history);
}

async function buildEventHistoryEntry(contexts, event) {
  const merged = new Map();
  let context = contexts[0];
  let rankingName = "";

  for (const candidate of contexts) {
    try {
      const data = await getRankings(candidate, "event");
      context = candidate;
      rankingName ||= data.rankings?.name || "";
      for (const row of data.rankings?.data || []) {
        const key = normalizeName(row.name || row.user_id || row.rank);
        if (!key) continue;
        const old = merged.get(key);
        if (!old || Number(row.rank || 999999) < Number(old.rank || 999999)) merged.set(key, row);
      }
    } catch {
      // Try the next account.
    }
  }

  const rows = [...merged.values()].map((row) => ({
    rank: Number(row.rank || 0),
    name: value(row.name),
    stat: Number(row.stat || 0),
  }))
    .filter((row) => row.name)
    .sort((a, b) => Number(a.rank || 999999) - Number(b.rank || 999999));
  if (!rows.length) return null;

  return {
    type: historyEventType(context),
    event_id: String(context.ranking_index || ""),
    event_name: context.event_name || rankingName || "",
    event_date: context.event_time || "",
    saved_at: new Date(event?.scheduledTime || Date.now()).toISOString(),
    bge_names: context.bge_names || [],
    rows,
  };
}

function historyEventType(context) {
  const name = String(context?.event_name || "").toLowerCase();
  if (context?.war_active === true || (name.includes("guild war") && !name.includes("placement"))) return "guild_war";
  if (name.includes("guild clash")) return "guild_clash";
  return "";
}

async function runScheduledWarSnapshots(request, env, event, phase = "before") {
  if (!env.DECK_CACHE) return;

  const { guilds } = await discoverGuilds(request, env);
  const guildIds = orderedGuildIds(guilds);
  if (!guildIds.length) return;
  if (phase !== "after") {
    await writeWarSnapshotState(env, {
      phase,
      updated_at: new Date(event.scheduledTime || Date.now()).toISOString(),
      last_guilds: [],
      errors: [],
      skipped: "War round snapshots only run after rounds end",
    });
    return;
  }

  const selected = guildIds.filter((guildId) => guilds[guildId]?.some((context) => isGuildWarEventContext(context)));

  const errors = [];
  for (const guildId of selected) {
    try {
      await refreshWarSnapshotForGuild(env, guildId, guilds[guildId], phase);
    } catch (error) {
      errors.push({ guild_id: guildId, error: error.message || String(error) });
    }
  }

  await writeWarSnapshotState(env, {
    phase,
    updated_at: new Date(event.scheduledTime || Date.now()).toISOString(),
    last_guilds: selected,
    errors,
  });
}

async function refreshWarSnapshotForGuild(env, guildId, contexts, phase = "before") {
  if (!contexts?.length) return;
  if (phase !== "after") return;

  const warContexts = contexts.filter((context) => isGuildWarEventContext(context));
  if (!warContexts.length) return;

  const [context, data] = await firstWorkingContext(warContexts, (c) => getRankings(c, "event_guild"));
  if (isLiveWarRound(context)) return;
  const rows = normalizeWarScoreRows(data.rankings?.data || []);
  const currentTotals = totalsFromWarRows(rows);
  const completedRound = Number(context.war_history_count || 0);

  if (!Number.isFinite(completedRound) || completedRound < 1) {
    await saveWarTotalBaselineSnapshot(env, context, guildId, context.guild_name, currentTotals);
    return;
  }

  const baseline = await readWarTotalBaselineSnapshot(env, guildId, context.ranking_index);
  const baselineMatchesEvent = baseline?.ranking_index && String(baseline.ranking_index) === String(context.ranking_index);
  const previousTotals = baselineMatchesEvent ? baseline.totals : {};
  const roundRows = rowsFromWarTotalDelta(rows, previousTotals);
  await saveWarRoundSnapshotForContext(env, context, guildId, context.guild_name || baseline?.guild_name, roundRows, completedRound);
  await saveWarTotalBaselineSnapshot(env, context, guildId, context.guild_name, currentTotals);
}

async function readAutoRefreshState(env) {
  const text = await env.DECK_CACHE.get("deckhashes:auto-refresh");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeAutoRefreshState(env, state) {
  await env.DECK_CACHE.put("deckhashes:auto-refresh", JSON.stringify(state));
}

async function readWarSnapshotState(env) {
  const text = await env.DECK_CACHE.get("war-rounds:auto-refresh");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeWarSnapshotState(env, state) {
  await env.DECK_CACHE.put("war-rounds:auto-refresh", JSON.stringify(state));
}

function warSnapshotsKey(guildId, eventId = "") {
  const suffix = eventId ? `:event:${eventId}` : "";
  return `war-rounds:guild:${guildId}${suffix}`;
}

function warTotalBaselineKey(guildId, eventId = "") {
  const suffix = eventId ? `:event:${eventId}` : "";
  return `war-rounds:baseline:guild:${guildId}${suffix}`;
}

async function readWarSnapshots(env, guildId, eventId = "") {
  if (!env.DECK_CACHE) return null;
  const text = await env.DECK_CACHE.get(warSnapshotsKey(guildId, eventId));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeWarSnapshots(env, guildId, eventId, cache, context = null) {
  if (!env.DECK_CACHE) return;
  await env.DECK_CACHE.put(warSnapshotsKey(guildId, eventId), JSON.stringify(cache), warKvPutOptions(context));
}

function totalsFromWarRows(rows) {
  const totals = {};
  for (const row of rows || []) {
    const key = normalizeName(row.name);
    if (!key) continue;
    totals[key] = {
      name: value(row.name),
      score: Number(row.stat || 0),
    };
  }
  return totals;
}

async function saveWarTotalBaselineSnapshot(env, context, guildId, guildName, totals) {
  if (!env.DECK_CACHE) return;
  await env.DECK_CACHE.put(warTotalBaselineKey(guildId, context.ranking_index), JSON.stringify({
    guild_id: guildId,
    guild_name: guildName,
    completed_round: Number(context.war_history_count || 0),
    enemy_name: getOpponentGuildName(context.war_match, guildName),
    ranking_index: context.ranking_index,
    totals: totals || {},
    updated_at: new Date().toISOString(),
  }), warKvPutOptions(context));
}

async function readWarTotalBaselineSnapshot(env, guildId, eventId = "") {
  if (!env.DECK_CACHE) return null;
  const text = await env.DECK_CACHE.get(warTotalBaselineKey(guildId, eventId));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function rowsFromWarTotalDelta(afterRows, beforeTotals) {
  const rows = [];
  for (const row of afterRows || []) {
    const key = normalizeName(row.name);
    if (!key) continue;
    const before = Number(beforeTotals?.[key]?.score || 0);
    const after = Number(row.stat || 0);
    rows.push({
      name: value(row.name),
      stat: Math.max(0, after - before),
    });
  }

  rows.sort((a, b) => Number(b.stat || 0) - Number(a.stat || 0) || value(a.name).localeCompare(value(b.name)));
  let previousScore = null;
  let previousRank = 0;
  rows.forEach((row, index) => {
    const score = Number(row.stat || 0);
    row.rank = score === previousScore ? previousRank : index + 1;
    previousScore = score;
    previousRank = row.rank;
  });
  return rows;
}

async function saveWarRoundSnapshotForContext(env, context, guildId, guildName, rows, roundOverride = null) {
  if (!env.DECK_CACHE) return;
  rows ||= [];
  const round = Number(roundOverride || Number(context.war_history_count || 0) + 1);
  if (!Number.isFinite(round) || round < 1) return;

  const players = {};
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (!key) continue;
    players[key] = {
      name: value(row.name),
      rank: Number(row.rank || 0),
      score: Number(row.stat || 0),
    };
  }

  const eventId = context.ranking_index || "";
  const cache = await readWarSnapshots(env, guildId, eventId) || { guild_id: guildId, guild_name: guildName, event_id: eventId, rounds: [] };
  cache.guild_id = guildId;
  cache.guild_name = guildName;
  cache.event_id = eventId;
  cache.updated_at = new Date().toISOString();
  cache.rounds = Array.isArray(cache.rounds) ? cache.rounds.filter((entry) => Number(entry.round) !== round) : [];
  cache.rounds.push({
    round,
    guild_name: guildName,
    enemy_name: getOpponentGuildName(context.war_match, guildName),
    players,
    updated_at: cache.updated_at,
  });
  cache.rounds.sort((a, b) => Number(a.round || 0) - Number(b.round || 0));
  await writeWarSnapshots(env, guildId, eventId, cache, context);
}

function warKvPutOptions(context) {
  const now = Math.floor(Date.now() / 1000);
  const trackingEnd = Number(context?.war_tracking_end_time || 0);
  const ttl = trackingEnd > now ? trackingEnd - now + 6 * 60 * 60 : 7 * 24 * 60 * 60;
  return { expirationTtl: Math.max(60, Math.min(ttl, 14 * 24 * 60 * 60)) };
}

function deckCacheKey(guildId) {
  return `deckhashes:guild:${guildId}`;
}

async function readDeckCache(env, guildId) {
  if (!env.DECK_CACHE) return null;
  const text = await env.DECK_CACHE.get(deckCacheKey(guildId));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeDeckCache(env, guildId, cache) {
  await env.DECK_CACHE.put(deckCacheKey(guildId), JSON.stringify(cache));
}

async function readDeckCachesForGuilds(env, guilds) {
  const caches = {};
  for (const guildId of orderedGuildIds(guilds || {})) {
    caches[guildId] = await readDeckCache(env, guildId);
  }
  return caches;
}

function buildCachedRowsByUserId(cacheByGuildId) {
  const byUserId = new Map();
  for (const cache of Object.values(cacheByGuildId || {})) {
    for (const row of cache?.rows || []) {
      const normalized = normalizeDeckCacheRow(row);
      if (!normalized.user_id) continue;
      const existing = byUserId.get(normalized.user_id);
      if (!existing || timestampFromIso(normalized.updated_at) >= timestampFromIso(existing.updated_at)) {
        byUserId.set(normalized.user_id, normalized);
      }
    }
  }
  return byUserId;
}

async function currentGuildDeckRows(contexts, cache, cachedRowsByUserId) {
  const [, data] = await firstWorkingContext(contexts, getUpdateFaction);
  const cachedByUserId = new Map((cache?.rows || []).map((row) => {
    const normalized = normalizeDeckCacheRow(row);
    return [String(normalized.user_id), normalized];
  }));

  return getMemberRows(data)
    .map((member) => {
      const userId = String(getValue(member, ["user_id", "id", "uid"]));
      const name = String(getValue(member, ["name", "username", "user_name", "player_name"]));
      const cached = cachedByUserId.get(userId) || cachedRowsByUserId.get(userId) || {};
      return normalizeDeckCacheRow({ ...cached, name, user_id: userId });
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function timestampFromIso(input) {
  if (!input) return 0;
  const time = new Date(input).getTime();
  return Number.isFinite(time) ? time : 0;
}

async function mergeDeckCacheRows(env, guildId, guildName, rows, options = {}) {
  const now = new Date().toISOString();
  const existing = options.reset ? null : await readDeckCache(env, guildId);
  const byUserId = new Map((existing?.rows || []).map((row) => [String(row.user_id), row]));

  for (const row of rows) {
    const userId = String(row.user_id);
    const existingRow = byUserId.get(userId) || options.fallbackRowsByUserId?.get(userId);
    byUserId.set(userId, mergeDeckCacheRow(existingRow, row, now));
  }

  const mergedRows = [...byUserId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const cache = {
    guild_id: String(guildId),
    guild_name: guildName,
    updated_at: now,
    total: options.total ?? existing?.total ?? mergedRows.length,
    rows: mergedRows,
  };
  await writeDeckCache(env, guildId, cache);
  return cache;
}

function mergeDeckCacheRow(existingRow, row, now) {
  const existing = normalizeDeckCacheRow(existingRow || {});
  const incoming = normalizeDeckCacheRow(row || {});
  const isIncomingDefence = incoming.defence_source === "DEF deck";
  const merged = {
    ...existing,
    ...incoming,
    name: incoming.name || existing.name,
    user_id: String(incoming.user_id || existing.user_id || ""),
    error: incoming.error || "",
    updated_at: incoming.updated_at || now,
  };

  if (!isIncomingDefence && existing.defence_hash) {
    merged.defence_hash = existing.defence_hash;
    merged.defence_deck_name = existing.defence_deck_name;
    merged.defence_source = existing.defence_source;
    merged.defence_updated_at = existing.defence_updated_at;
  }
  if (isIncomingDefence && existing.offence_hash) {
    merged.hash = existing.hash || existing.offence_hash;
    merged.deck_name = existing.deck_name || existing.offence_deck_name;
    merged.offence_hash = existing.offence_hash;
    merged.offence_deck_name = existing.offence_deck_name;
    merged.offence_updated_at = existing.offence_updated_at;
  }
  if (!incoming.offence_hash && existing.offence_hash) {
    merged.hash = existing.hash || existing.offence_hash;
    merged.deck_name = existing.deck_name || existing.offence_deck_name;
    merged.offence_hash = existing.offence_hash;
    merged.offence_deck_name = existing.offence_deck_name;
    merged.offence_updated_at = existing.offence_updated_at;
  }
  if (!incoming.active_hash) {
    merged.active_hash = existing.active_hash;
    merged.active_deck_name = existing.active_deck_name;
    merged.active_updated_at = existing.active_updated_at;
  }

  return normalizeDeckCacheRow(merged);
}

function normalizeDeckCacheRow(row) {
  const isDefenceOnly = row.defence_source === "DEF deck" && !row.offence_hash;
  const offenceHash = row.offence_hash || (isDefenceOnly ? "" : row.hash) || "";
  const offenceDeckName = row.offence_deck_name || (isDefenceOnly ? "" : row.deck_name) || "";
  const hasStoredDefence = Boolean(row.defence_hash);
  const defenceHash = row.defence_hash || offenceHash || "";
  const defenceDeckName = hasStoredDefence ? (row.defence_deck_name || "") : offenceDeckName;
  const defenceSource = hasStoredDefence ? (row.defence_source || "DEF deck") : (offenceHash ? "Fallback offence" : "");
  const defenceUpdatedAt = hasStoredDefence ? (row.defence_updated_at || "") : (row.offence_updated_at || "");
  return {
    name: row.name || "",
    user_id: String(row.user_id || ""),
    active_hash: row.active_hash || "",
    active_deck_name: row.active_deck_name || "",
    active_updated_at: row.active_updated_at || "",
    hash: offenceHash,
    error: row.error || "",
    deck_name: offenceDeckName,
    offence_hash: offenceHash,
    offence_deck_name: offenceDeckName,
    offence_updated_at: row.offence_updated_at || (isDefenceOnly ? "" : row.updated_at) || "",
    defence_hash: defenceHash,
    defence_deck_name: defenceDeckName,
    defence_source: defenceSource,
    defence_updated_at: defenceUpdatedAt,
    updated_at: row.updated_at || "",
  };
}

function deckCacheRow(name, userId, deck) {
  const now = new Date().toISOString();
  const deckName = deck.deck_name || "";
  const isDefence = isDefenceDeckName(deckName);
  const row = {
    name,
    user_id: String(userId),
    active_hash: deck.hash || "",
    active_deck_name: deckName,
    active_updated_at: now,
    hash: deck.hash || "",
    error: "",
    deck_name: deckName,
    updated_at: now,
  };
  if (isDefence) {
    row.offence_hash = deck.hash || "";
    row.offence_deck_name = deckName;
    row.offence_updated_at = now;
    row.defence_hash = deck.hash || "";
    row.defence_deck_name = deckName;
    row.defence_source = "DEF deck";
    row.defence_updated_at = now;
  } else {
    row.offence_hash = deck.hash || "";
    row.offence_deck_name = deckName;
    row.offence_updated_at = now;
    row.defence_hash = deck.hash || "";
    row.defence_deck_name = deckName;
    row.defence_source = "Fallback offence";
    row.defence_updated_at = now;
  }
  return row;
}

function deckCacheErrorRow(name, userId, error) {
  return {
    name,
    user_id: String(userId),
    hash: "",
    error: error.message || String(error),
    updated_at: new Date().toISOString(),
  };
}

function isDefenceDeckName(deckName) {
  return String(deckName || "").toLowerCase().includes("def");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderSelectedGuildPage(request, env, guildId, url, active, title, ttl, bodyLoader) {
  return cached(request, `${active}:${guildId || "first"}`, ttl, async () => {
    const { guilds, errors } = await discoverGuilds(request, env);
    const activeGuildId = selectedOrFirstGuild(guilds, guildId);
    const contexts = guilds[activeGuildId];
    if (!contexts) return page("Guild Not Found", `<h1>Guild not found</h1><p>No discovered guild with that ID.</p>${discoveryErrors(errors)}`, active, guilds, url);

    try {
      const [context, body] = await firstWorkingContext(contexts, bodyLoader);
      return page(title, body, active, guilds, withGuild(url, context.guild_id));
    } catch (error) {
      return page(`${title} Error`, `<h1>Could not load ${escapeHtml(title.toLowerCase())}</h1><p class="error">${escapeHtml(error.message || String(error))}</p>`, active, guilds, withGuild(url, activeGuildId));
    }
  });
}

function page(title, body, active, guilds, url) {
  const selectedGuildId = selectedOrFirstGuild(guilds, url.searchParams.get("guild") || "");
  const key = url.searchParams.get("key") || "";
  const keyQuery = key ? `&key=${encodeURIComponent(key)}` : "";
  const guildOptions = orderedGuildEntries(guilds || {}).map(([guildId, contexts]) => {
    const selected = guildId === selectedGuildId ? " selected" : "";
    return `<option value="${escapeHtml(guildId)}"${selected}>${escapeHtml(contexts[0].guild_name)}</option>`;
  }).join("");

  const headerDropdown = guildOptions ? `<div class="guild-select header-guild-select"><label for="guild-select">Selected Guild</label><select id="guild-select">${guildOptions}</select></div>` : "";
  const href = (path) => {
    const params = new URLSearchParams();
    if (selectedGuildId) params.set("guild", selectedGuildId);
    if (key) params.set("key", key);
    if (path === "/war") params.set("refresh", "1");
    const query = params.toString();
    return `${path}${query ? `?${query}` : ""}`;
  };

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:Arial,sans-serif;margin:28px;background:#f6f6f6;color:#1f1f1f}.app-title{margin:0 0 12px 0;font-size:42px;line-height:1.1;font-weight:800}.nav{margin-bottom:24px}.nav-row{margin-bottom:6px}a.button{display:inline-block;padding:8px 13px;margin-right:7px;margin-bottom:6px;background:#46689a;color:white;text-decoration:none;border-radius:6px;font-size:15px}a.button.secondary{background:#555}.copy-button{margin-top:12px;padding:8px 13px;background:#46689a;color:white;border:0;border-radius:6px;font-size:15px;cursor:pointer}.copy-button:disabled{background:#999;cursor:not-allowed}.filter-input{display:block;width:min(420px,100%);box-sizing:border-box;margin:0 0 12px 0;padding:9px 11px;border:1px solid #bbb;border-radius:6px;background:white;font-size:15px}.card{background:white;padding:18px;margin-bottom:16px;border-radius:6px;border:1px solid #ddd}h1{margin-top:0}table{width:100%;border-collapse:collapse;background:white;font-size:14px}table.compact-table{width:auto;min-width:520px;max-width:100%}.compact-table th,.compact-table td{white-space:nowrap}.compact-table th:nth-child(2),.compact-table td:nth-child(2){min-width:190px}th,td{padding:5px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top;line-height:1.25}th{background:#e9eef4}.sortable-table th[data-sort-col]{cursor:pointer}.sortable-table th[data-sort-col]::after{content:"";font-size:10px;color:#666;margin-left:4px}.sortable-table th.sort-asc::after{content:"▲"}.sortable-table th.sort-desc::after{content:"▼"}.muted-small{color:#666;font-size:11px;font-weight:400}.number{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#666;font-size:18px}.error{color:#9b1c1c}.guild-links{margin-bottom:22px}.guild-link{display:inline-block;padding:9px 14px;margin-right:8px;margin-bottom:8px;background:white;color:#222;text-decoration:none;border:1px solid #ccc;border-radius:6px;font-size:15px}.guild-link.active{background:#46689a;color:white;border-color:#46689a}.message{max-width:900px}.hash-cell{font-family:Consolas,monospace;font-size:13px;word-break:break-all}.guild-panel{display:none}.guild-panel.active{display:block}.guild-select{margin:-2px 0 18px 0}.guild-select label{margin-right:8px;font-weight:700;color:#444}.guild-select select{padding:8px 10px;border:1px solid #bbb;border-radius:6px;font-size:16px;background:white}tr.tool-guild-row td{background:#e4ecff}.event-history-scroll{overflow-x:auto;padding-bottom:10px}.event-history-compare-table{width:max-content;min-width:0;max-width:none}.event-history-compare-table th,.event-history-compare-table td{min-width:0;white-space:nowrap;padding-left:14px;padding-right:14px}.event-history-compare-table th+th,.event-history-compare-table td+td{border-left:2px solid #cfd7e2}.event-history-compare-table th:first-child,.event-history-compare-table td:first-child{position:sticky;left:0;z-index:1;min-width:54px;background:white}.event-history-compare-table th:first-child{z-index:2;background:#e9eef4}.event-history-compare-table td.tool-guild-row{background:#e4ecff}.event-history-compare-table td.event-best{background:#dff3e6}.event-history-compare-table td.event-worst{background:#f6d1cc}.war-round-grid{display:grid;grid-template-columns:max-content 250px;gap:32px;align-items:start;justify-content:start}.war-column-spacer{height:50px}.missing-attacks-panel h2{margin:0 0 8px 0;font-size:24px}.missing-attacks-panel table.compact-table{min-width:220px;width:100%}.missing-attacks-panel .compact-table th:nth-child(1),.missing-attacks-panel .compact-table td:nth-child(1){min-width:0}.age-green{background:#dff3e6;color:#12351f}.age-yellow{background:#fff4bf;color:#3b3000}.age-orange{background:#ffc070;color:#331700}.age-red{background:#d65a50;color:#fff}.age-unknown{background:#eee;color:#333}.age-badge{display:inline-block;min-width:78px;padding:2px 7px;border-radius:4px;font-weight:700;text-align:center}.screenshot-exit{display:none;padding:4px 8px;margin:0 0 4px auto;background:#555;color:white;border:0;border-radius:5px;font-size:11px}body.screenshot-mode{margin:8px;background:white}.screenshot-mode .app-title,.screenshot-mode .header-guild-select,.screenshot-mode .nav,.screenshot-mode #guild-tabs,.screenshot-mode .filter-input,.screenshot-mode .card{display:none}.screenshot-mode .screenshot-exit{display:block}.screenshot-mode .guild-panel h1{font-size:22px;margin:0 0 4px 0}.screenshot-mode table.compact-table{font-size:11px;min-width:0}.screenshot-mode th,.screenshot-mode td{padding:1px 5px;line-height:1.08}.screenshot-mode .compact-table th:nth-child(2),.screenshot-mode .compact-table td:nth-child(2){min-width:150px}@media(max-width:850px){.war-round-grid{display:block}.war-column-spacer{display:none}.missing-attacks-panel{margin-top:18px}table.compact-table{min-width:0;width:100%}}
.war-round-grid{gap:48px}
.war-column-spacer{height:36px}
.war-vs-table{width:auto;min-width:520px;margin:0 0 8px 0;background:white}
.war-vs-table th,.war-vs-table td{padding:4px 12px}
.war-vs-table th:first-child,.war-vs-table th:last-child{font-size:18px}
.war-own-number{text-align:left;font-variant-numeric:tabular-nums}
.war-vs-label{text-align:center;color:#555;width:80px}
.war-vs-label span{font-size:12px;font-weight:700}
.war-member-table{min-width:760px}
.war-member-table th:nth-child(2),.war-member-table td:nth-child(2),.war-member-table th:nth-child(6),.war-member-table td:nth-child(6){min-width:180px}
.war-member-vs{text-align:center;color:#555;min-width:44px;padding-left:18px!important;padding-right:18px!important}
@media(max-width:850px){.war-column-spacer{display:none}}
</style>
</head>
<body>
<button class="screenshot-exit" type="button" data-exit-screenshot-mode="1">Exit</button>
<h1 class="app-title">Family Guild Tool</h1>
${headerDropdown}
<div class="nav">
<div class="nav-row">
<a data-feature-link="1" class="button${active === "activity" ? "" : " secondary"}" href="${href("/activity")}">Guild Activity</a>
<a data-feature-link="1" class="button${active === "online" ? "" : " secondary"}" href="${href("/online")}">Last Online</a>
<a data-feature-link="1" class="button${active === "decks" ? "" : " secondary"}" href="${href("/decks")}">Deck Hashes</a>
<a data-feature-link="1" class="button${active === "chat" ? "" : " secondary"}" href="${href("/chat")}">Guild Chat</a>
</div>
<div class="nav-row">
<a data-feature-link="1" class="button${active === "global" ? "" : " secondary"}" href="${href("/global")}">Global Rank</a>
<a data-feature-link="1" class="button${active === "guild" ? "" : " secondary"}" href="${href("/guild")}">Guild Rank</a>
<a data-feature-link="1" class="button${active === "war" ? "" : " secondary"}" href="${href("/war")}">War Round</a>
<a data-feature-link="1" class="button${active === "war-history" ? "" : " secondary"}" href="${href("/war-history")}">War History</a>
<a data-feature-link="1" class="button${active === "event-history" ? "" : " secondary"}" href="${href("/event-history")}">Event History</a>
</div>
</div>
<script>
(function(){var select=document.getElementById('guild-select'); if(!select) return; var key=${JSON.stringify(key)}; function updateLinks(){document.querySelectorAll('[data-feature-link]').forEach(function(link){var url=new URL(link.href,window.location.origin);url.searchParams.set('guild',select.value);if(key) url.searchParams.set('key',key);link.href=url.pathname+url.search;});} select.addEventListener('change',updateLinks); updateLinks(); document.querySelectorAll('[data-feature-link]').forEach(function(link){link.addEventListener('click',function(){var url=new URL(link.href,window.location.origin);if(url.pathname==='/war'){url.searchParams.set('refresh',String(Date.now()));link.href=url.pathname+url.search;}});});})();
</script>
${body}
${guildTabsScript(key)}
<script>
(function(){
  document.querySelectorAll('[data-table-filter]').forEach(function(input){
    var table = document.getElementById(input.getAttribute('data-table-filter'));
    if (!table) return;
    input.addEventListener('input', function(){
      var query = input.value.trim().toLowerCase();
      Array.from(table.rows).forEach(function(row, index){
        if (index === 0) return;
        row.style.display = !query || row.textContent.toLowerCase().includes(query) ? '' : 'none';
      });
    });
  });
  function exportTableText(table, title) {
    var lines = [];
    if (title) lines.push(title);
    Array.from(table.rows).forEach(function(row) {
      if (row.style.display === 'none') return;
      var cells = Array.from(row.cells).map(function(cell) {
        return cell.innerText.replace(/\\s+/g, ' ').trim();
      });
      lines.push(cells.join('\\t'));
    });
    return lines.join('\\n');
  }
  document.querySelectorAll('[data-export-table]').forEach(function(button) {
    button.__handledByDirectListener = true;
    button.addEventListener('click', async function() {
      var table = document.getElementById(button.getAttribute('data-export-table'));
      if (!table) return;
      var original = button.textContent;
      try {
        await navigator.clipboard.writeText(exportTableText(table, button.getAttribute('data-export-title') || ''));
        button.textContent = 'Copied';
      } catch (error) {
        button.textContent = 'Copy failed';
      }
      setTimeout(function() { button.textContent = original; }, 1500);
    });
  });
  document.querySelectorAll('[data-screenshot-mode]').forEach(function(button) {
    button.__handledByDirectListener = true;
    button.addEventListener('click', function() {
      document.body.classList.toggle('screenshot-mode');
    });
  });
  document.querySelectorAll('[data-exit-screenshot-mode]').forEach(function(button) {
    button.addEventListener('click', function() {
      document.body.classList.remove('screenshot-mode');
    });
  });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') document.body.classList.remove('screenshot-mode');
  });
  document.addEventListener('input', function(event) {
    if (!event.target.matches('[data-table-filter]')) return;
    var table = document.getElementById(event.target.getAttribute('data-table-filter'));
    if (!table) return;
    var query = event.target.value.trim().toLowerCase();
    Array.from(table.rows).forEach(function(row, index){
      if (index === 0) return;
      row.style.display = !query || row.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
  });
  document.addEventListener('click', async function(event) {
    var sortHeader = event.target.closest('th[data-sort-col]');
    if (sortHeader) {
      var table = sortHeader.closest('table');
      if (table) {
        var column = Number(sortHeader.getAttribute('data-sort-col'));
        var type = sortHeader.getAttribute('data-sort-type') || 'text';
        var direction = sortHeader.classList.contains('sort-desc') ? 'asc' : 'desc';
        Array.from(table.querySelectorAll('th[data-sort-col]')).forEach(function(header){
          header.classList.remove('sort-asc', 'sort-desc');
        });
        sortHeader.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
        var rows = Array.from(table.rows).slice(1);
        rows.sort(function(left, right){
          var a = (left.cells[column] && left.cells[column].innerText || '').trim();
          var b = (right.cells[column] && right.cells[column].innerText || '').trim();
          var result;
          if (type === 'number') {
            var an = Number(a.replace(/[^0-9.-]/g, ''));
            var bn = Number(b.replace(/[^0-9.-]/g, ''));
            if (!Number.isFinite(an)) an = -Infinity;
            if (!Number.isFinite(bn)) bn = -Infinity;
            result = an - bn;
          } else {
            result = a.localeCompare(b);
          }
          return direction === 'asc' ? result : -result;
        });
        rows.forEach(function(row){ table.tBodies[0].appendChild(row); });
      }
    }
    var exportButton = event.target.closest('[data-export-table]');
    if (exportButton && !exportButton.__handledByDirectListener) {
      var table = document.getElementById(exportButton.getAttribute('data-export-table'));
      if (!table) return;
      var original = exportButton.textContent;
      try {
        await navigator.clipboard.writeText(exportTableText(table, exportButton.getAttribute('data-export-title') || ''));
        exportButton.textContent = 'Copied';
      } catch (error) {
        exportButton.textContent = 'Copy failed';
      }
      setTimeout(function() { exportButton.textContent = original; }, 1500);
    }
    var screenshotButton = event.target.closest('[data-screenshot-mode]');
    if (screenshotButton && !screenshotButton.__handledByDirectListener) document.body.classList.toggle('screenshot-mode');
  });
})();
</script>
</body>
</html>`;
}

function discoveryErrors(errors) {
  if (!errors || !errors.length) return "";
  return `<div class="card"><h2>Discovery Errors</h2><ul>${errors.map((error) => `<li class="error">${escapeHtml(error)}</li>`).join("")}</ul><p class="muted">Try adding <code>?refresh=1</code> to the URL after changing secrets.</p></div>`;
}

function guildTabsScript(key = "") {
  return `<script>
document.querySelectorAll('#guild-tabs .guild-link').forEach(function(link){link.addEventListener('click',function(event){event.preventDefault();var guild=link.getAttribute('data-guild');document.querySelectorAll('#guild-tabs .guild-link').forEach(function(item){item.classList.remove('active');});document.querySelectorAll('.guild-panel').forEach(function(panel){panel.classList.remove('active');});link.classList.add('active');var panel=document.getElementById('guild-panel-'+guild);if(panel) panel.classList.add('active');var url=new URL(window.location.href);url.searchParams.set('guild',guild);${key ? `url.searchParams.set('key',${JSON.stringify(key)});` : ""}history.replaceState(null,'',url.toString());});});
</script>`;
}

function withGuild(url, guildId) {
  const next = new URL(url.toString());
  if (guildId) next.searchParams.set("guild", guildId);
  return next;
}

function selectedOrFirstGuild(guilds, selectedGuildId = "") {
  if (selectedGuildId && guilds[selectedGuildId]) return selectedGuildId;
  return orderedGuildIds(guilds || {})[0] || "";
}

function attachGuildOrder(guilds, guildOrder) {
  const order = Array.isArray(guildOrder) && guildOrder.length ? guildOrder.map(String) : Object.keys(guilds || {});
  Object.defineProperty(guilds, "__order", {
    value: order.filter((guildId) => guilds[guildId]),
    enumerable: false,
    configurable: true,
  });
}

function orderedGuildIds(guilds) {
  if (!guilds) return [];
  const ordered = Array.isArray(guilds.__order) ? guilds.__order.filter((guildId) => guilds[guildId]) : [];
  const seen = new Set(ordered);
  for (const guildId of Object.keys(guilds)) {
    if (!seen.has(guildId)) ordered.push(guildId);
  }
  return ordered;
}

function orderedGuildEntries(guilds) {
  return orderedGuildIds(guilds).map((guildId) => [guildId, guilds[guildId]]);
}

function addCurrentRanks(rows) {
  const sorted = [...rows].sort((a, b) => Number(b.stat || 0) - Number(a.stat || 0));
  let previousScore = null;
  let previousRank = 0;
  sorted.forEach((row, index) => {
    const score = Number(row.stat || 0);
    row.current_rank = score === previousScore ? previousRank : index + 1;
    previousScore = score;
    previousRank = row.current_rank;
  });
  return sorted;
}

function getMemberRows(data) {
  const faction = data.faction || {};
  let members = faction.members || [];
  if (!Array.isArray(members) && members && typeof members === "object") members = Object.values(members);
  return [...members].sort((a, b) => timestampNumber(getValue(b, ["last_update_time", "last_online", "last_login"])) - timestampNumber(getValue(a, ["last_update_time", "last_online", "last_login"])));
}

function getFeedRows(data) {
  const rows = data.guild_feed || data.feed || [];
  return rows.filter((row) => ["1", "3", "4"].includes(String(row.type ?? row.activity_type ?? ""))).sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
}

function getChatRows(data) {
  const messages = data.chat_messages || {};
  const rows = (messages && messages.guild) || data.chat || data.messages || [];
  return rows.sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
}

function describeActivity(item) {
  const activityType = String(item.type ?? item.activity_type ?? "");
  const user = item.user_name || item.name || item.username || "";
  const target = item.target_user_name || "";
  if (activityType === "1") return `${user} joined`;
  if (activityType === "3") return `${user} left or was removed`;
  if (activityType === "4") return target ? `${user} changed ${target}'s rank/role to ${roleName(item.rank)}` : `${user} changed a rank/role`;
  return String(getValue(item, ["message", "text", "action", "type", "activity_type"]));
}

function roleName(rank) {
  return ({ 0: "Member", 1: "Member", 3: "Veteran", 5: "Officer", 8: "General", 10: "Leader" })[String(rank)] || `Role ${rank}`;
}

function getValue(row, names) {
  for (const name of names) if (row && row[name] != null) return row[name];
  return "";
}

function value(input) {
  return input == null ? "" : String(input);
}

function normalizeName(input) {
  return value(input).trim().toLowerCase();
}

function normalizeWarScoreRows(rows) {
  return (rows || [])
    .filter((row) => value(row.name).trim())
    .map((row) => ({ ...row, stat: Number(row.stat || 0) }))
    .sort((a, b) => Number(b.stat || 0) - Number(a.stat || 0));
}

function formatNumber(input) {
  const number = Number(input || 0);
  if (!Number.isFinite(number)) return "0";
  return number.toFixed(1).replace(/\.0$/, "");
}

function renderWarMatchSummary(data) {
  const match = data.guild_war_current_match || {};
  if (!match || (!match.us_name && !match.them_name)) return "";
  const usScore = Number(match.us_kills || match.us_score || 0);
  const themScore = Number(match.them_kills || match.them_score || 0);
  const difference = usScore - themScore;
  const endsAt = match.end_time ? ` &nbsp; <strong>Ends:</strong> ${escapeHtml(formatTime(match.end_time))} UTC` : "";
  return `<div class="card"><p><strong>${escapeHtml(match.us_name || "Us")}</strong> ${escapeHtml(usScore)} - ${escapeHtml(themScore)} <strong>${escapeHtml(match.them_name || "Opponent")}</strong> &nbsp; <strong>Difference:</strong> ${escapeHtml(difference)}${endsAt}</p></div>`;
}

function renderWarVsSummary(match = {}, ownStats, enemyRows = []) {
  match ||= {};
  const usName = value(match.us_name || "Us");
  const themName = value(match.them_name || "Opponent");
  const usScore = Number(match.us_kills || match.us_score || 0);
  const themScore = Number(match.them_kills || match.them_score || 0);
  const ownName = normalizeName(ownStats.name);
  const opponentName = normalizeName(usName) === ownName ? themName : usName;
  const rankedTotal = enemyRows.reduce((sum, row) => sum + Number(row.stat || 0), 0);
  const opponentTotal = rankedTotal || (normalizeName(usName) === ownName ? themScore : usScore);
  const opponentScored = enemyRows.length;
  const opponentMissing = Math.max(0, 50 - opponentScored);
  const opponentAverage = opponentScored ? opponentTotal / opponentScored : 0;
  const opponentAverageTotal = opponentAverage * 50;
  const opponentMaxTotal = opponentTotal + opponentMissing * 1300;
  const difference = Number(ownStats.total || 0) - opponentTotal;
  return `<table class="war-vs-table">
<tr><th>${escapeHtml(ownStats.name)}: ${escapeHtml(ownStats.total)}</th><th class="war-vs-label">vs<br><span>Diff ${escapeHtml(formatSignedNumber(difference))}</span></th><th>${escapeHtml(opponentName)}: ${escapeHtml(opponentTotal)}</th></tr>
<tr><td class="war-own-number">${escapeHtml(formatNumber(ownStats.average))}</td><td>Average</td><td class="number">${escapeHtml(formatNumber(opponentAverage))}</td></tr>
<tr><td class="war-own-number">${escapeHtml(formatNumber(ownStats.averageTotal))}</td><td>Average Total</td><td class="number">${escapeHtml(formatNumber(opponentAverageTotal))}</td></tr>
<tr><td class="war-own-number">${escapeHtml(formatNumber(ownStats.maxTotal))}</td><td>Max Total</td><td class="number">${escapeHtml(formatNumber(opponentMaxTotal))}</td></tr>
<tr><td class="war-own-number">${escapeHtml(ownStats.scored)} / 50</td><td>Players Attacked</td><td class="number">${escapeHtml(opponentScored)} / 50</td></tr>
</table>`;
}

function getOpponentGuildName(match = {}, guildName = "") {
  match ||= {};
  const usName = value(match.us_name || "");
  const themName = value(match.them_name || "");
  if (!usName && !themName) return "Enemy";
  return normalizeName(usName) === normalizeName(guildName) ? themName || "Enemy" : usName || "Enemy";
}

function formatSignedNumber(input) {
  const number = Number(input || 0);
  if (!Number.isFinite(number)) return "0";
  return number > 0 ? `+${formatNumber(number)}` : formatNumber(number);
}

function timestampNumber(input) {
  if (input == null || input === "" || input === 0 || input === "0") return 0;
  let number = Number(input);
  if (!Number.isFinite(number)) return 0;
  if (number > 1_000_000_000_000) number = Math.floor(number / 1000);
  return Math.floor(number);
}

function itemTimestamp(item) {
  return timestampNumber(getValue(item, ["gametime", "time", "timestamp", "date", "created_at"]));
}

function formatTime(input) {
  const number = timestampNumber(input);
  if (!number) return "";
  return new Date(number * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function formatIso(input) {
  if (!input) return "";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return String(input);
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function timeAgo(input) {
  const number = timestampNumber(input);
  if (!number) return "";
  let seconds = Math.max(0, Math.floor(Date.now() / 1000) - number);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  if (days) return `${days}d ${hours}h ago`;
  if (hours) return `${hours}h ${minutes}m ago`;
  return `${minutes}m ago`;
}

function lastOnlineClass(input) {
  const number = timestampNumber(input);
  if (!number) return "age-unknown";
  const days = (Math.floor(Date.now() / 1000) - number) / 86400;
  if (days >= 7) return "age-red";
  if (days >= 3) return "age-orange";
  if (days >= 1) return "age-yellow";
  return "age-green";
}

function firstRuneId(card) {
  const runes = card.runes || {};
  const runeValues = Array.isArray(runes) ? runes : typeof runes === "object" ? Object.values(runes) : [];
  if (!runeValues.length) return 0;
  const firstRune = runeValues[0];
  const itemId = Number(typeof firstRune === "object" ? firstRune.item_id : firstRune);
  if (!Number.isFinite(itemId)) return 0;
  return itemId >= 5000 ? itemId - 5000 : itemId;
}

function unitToHash(card) {
  const unitId = Number(card.unit_id || card.id);
  const level = Number(card.level || 1) - 1;
  const shortUnitId = unitId % 10000;
  const fusion = SHARD_CARD_IDS.has(String(shortUnitId)) ? Math.floor(level / 7) : Math.floor(unitId / 10000);
  const runeId = firstRuneId(card);
  let number = shortUnitId;
  number = number * 3 + fusion;
  number = number * 7 + (level % 7);
  number = number * MAX_RUNE_ID + runeId;
  return decimalToBase64(number);
}

function decimalToBase64(input) {
  let number = input;
  let result = "";
  for (let i = 0; i < 5; i += 1) {
    const part = number % 64;
    result += CHARS[part];
    number = Math.floor((number - part) / 64);
  }
  return result;
}

function deckToHash(deck) {
  const parts = [];
  if (deck.commander) parts.push(unitToHash(deck.commander));
  for (const card of deck.units || []) parts.push(unitToHash(card));
  return parts.join("");
}

function messageText(message) {
  return Array.isArray(message) ? message.join(", ") : value(message);
}

function escapeHtml(input) {
  return value(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}



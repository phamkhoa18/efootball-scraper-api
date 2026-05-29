/**
 * ─── Player Mapper ──────────────────────────────────────────────
 * Chuyển đổi dữ liệu thô từ API → document MongoDB
 * Lưu RAW data gốc + mapped data để không mất thông tin
 */
import config from "../config/default.js";

function mapStats(source) {
  if (!source) return {};
  return {
    offensiveAwareness: source.offensive_awareness ?? 40,
    ballControl: source.ball_control ?? 40,
    dribbling: source.dribbling ?? 40,
    tightPossession: source.tight_possession ?? 40,
    lowPass: source.low_pass ?? 40,
    loftedPass: source.lofted_pass ?? 40,
    finishing: source.finishing ?? 40,
    heading: source.heading ?? 40,
    setPieceTaking: source.set_piece_taking ?? 40,
    curl: source.curl ?? 40,
    defensiveAwareness: source.defensive_awareness ?? 40,
    trackingBack: source.defensive_engagement ?? 40,
    ballWinning: source.tackling ?? 40,
    aggression: source.aggression ?? 40,
    gkAwareness: source.gk_awareness ?? 40,
    gkCatching: source.gk_catching ?? 40,
    gkClearing: source.gk_parrying ?? 40,
    gkReflexes: source.gk_reflexes ?? 40,
    gkReach: source.gk_reach ?? 40,
    speed: source.speed ?? 40,
    acceleration: source.acceleration ?? 40,
    kickingPower: source.kicking_power ?? 40,
    jump: source.jumping ?? 40,
    physicalContact: source.physical_contact ?? 40,
    balance: source.balance ?? 40,
    stamina: source.stamina ?? 40,
  };
}

function extractSkills(player) {
  const skills = [];
  for (const key of Object.keys(player)) {
    if (key.startsWith("s_") && player[key] === 1) {
      const name = key
        .slice(2)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace("Gk", "GK")
        .replace("One Touch", "One-touch")
        .replace("Super Sub", "Super-sub");
      skills.push(name);
    }
  }
  return skills;
}

function extractPassives(player) {
  const passives = [];
  for (const key of Object.keys(player)) {
    if (key.startsWith("p_") && player[key] === 1) {
      const name = key
        .slice(2)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      passives.push(name);
    }
  }
  return passives;
}

/**
 * Map 1 player từ API response → MongoDB document
 * @param {Object} raw — raw player object từ API
 * @param {Object} localPaths — local image paths từ downloader
 */
export function mapPlayer(raw, localPaths = {}) {
  const efhubId = String(raw.id);

  // Positions
  const positions = [];
  const secondaryPositions = [];
  for (const f of config.positionFields) {
    if (raw[f] === 2) positions.push(f.toUpperCase());
    else if (raw[f] === 1) secondaryPositions.push(f.toUpperCase());
  }

  // Playstyle
  const playstyleStr = config.playstyleMap[raw.playing_style] || "None";
  const playstyles = playstyleStr !== "None" ? [playstyleStr] : [];

  return {
    // ── Identity ──
    efhubId,
    baseId: String(raw.base_id || ""),
    slug: raw.name_normalized
      ? `${raw.name_normalized.replace(/\s+/g, "-")}-${efhubId}`
      : efhubId,

    // ── Names ──
    name: raw.name || "Unknown",
    nameNormalized: raw.name_normalized || "",
    nameJa: raw.name_ja || "",
    nameZh: raw.name_zh || "",

    // ── Info ──
    nationality: raw.nationality || "Unknown",
    club: raw.team_name || "Unknown",
    league: raw.league ?? 0,
    age: raw.age || 0,
    height: raw.height || 0,
    weight: raw.weight || 0,
    foot: raw.foot === 0 ? "Right" : "Left",
    shirtNumber: raw.shirt_number || 0,

    // ── Positions ──
    positions: positions.length > 0 ? positions : ["CF"],
    secondaryPositions,

    // ── Card ──
    cardType: raw.card_type ?? 0,
    featured: raw.featured || "none",
    rarity: raw.featured === "none" ? "Standard" : raw.featured || "Standard",
    dreamTeam: raw.dream_team || 0,

    // ── Overall ──
    overall: {
      base: raw.overall_rating ?? 60,
      max: raw.overall_at_max_level ?? 80,
    },
    levels: {
      current: 1,
      max: raw.max_level ?? 1,
    },

    // ── Stats ──
    stats: {
      level1: mapStats(raw),
      maxLevel: mapStats(raw.max_attributes || raw),
    },

    // ── Skills & Playstyles ──
    skills: extractSkills(raw),
    playstyles,
    playstylePassives: extractPassives(raw),

    // ── Booster ──
    boosterId: raw.booster_id || 0,
    booster: raw.booster
      ? {
          name: raw.booster.name || "",
          stats: raw.booster.stats || {},
        }
      : null,

    // ── Condition ──
    condition: {
      form: raw.form === 2 ? "A" : raw.form === 1 ? "B" : "C",
      injuryResistance: raw.injury_resistance ?? 2,
    },
    weakFoot: {
      accuracy: raw.weak_foot_accuracy ?? 1,
      usage: raw.weak_foot_usage ?? 1,
    },

    // ── Body Model ──
    bodyModel: {
      armLength: raw.arm_length,
      armSize: raw.arm_size,
      calfSize: raw.calf_size,
      chestMeasurement: raw.chest_measurement,
      legLength: raw.leg_length,
      neckLength: raw.neck_length,
      neckSize: raw.neck_size,
      shoulderHeight: raw.shoulder_height,
      shoulderWidth: raw.shoulder_width,
      thighSize: raw.thigh_size,
      waistSize: raw.waist_size,
    },

    // ── Images (local paths) ──
    images: {
      transparent: localPaths.card_transparent || null,
      cardFront: localPaths.card_front || null,
      cardBack: localPaths.card_back || null,
      cardMobile: localPaths.card_mobile || null,
      cardDynamic: localPaths.card_dynamic || null,
    },
    emblems: {
      nationality: localPaths.emblem_nationality || null,
      league: localPaths.emblem_league || null,
      team: localPaths.emblem_team || null,
    },

    // ── Original URLs (backup) ──
    originalUrls: {
      cardImages: raw.card_images || {},
      emblemImages: raw.emblem_images || {},
    },

    // ── RAW data gốc — giữ nguyên không mất gì ──
    _raw: raw,

    // ── Meta ──
    timeAdded: raw.time_added ? new Date(raw.time_added * 1000) : null,
    source: "efootbase.com",
    scrapedAt: new Date(),
    updatedAt: new Date(),
  };
}

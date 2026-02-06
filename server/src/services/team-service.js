const mongoose = require('mongoose');
const TeamMember = require('../models/TeamMember');
const ErrorEvent = require('../models/Error');

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(['new', 'open', 'investigating']);
const RANGE_WINDOWS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const COLOR_PALETTE = Object.freeze([
  '#38bdf8',
  '#f97316',
  '#a855f7',
  '#22c55e',
  '#facc15',
  '#f87171',
  '#14b8a6',
  '#6366f1',
]);

const randomColor = () => COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];

const ensureAlertPreferences = (memberDoc) => {
  const preferences = buildAlertPreferences(memberDoc?.alertPreferences || {});
  if (!preferences.email.unsubscribeToken && memberDoc?.alertPreferences?.email?.unsubscribeToken) {
    preferences.email.unsubscribeToken = memberDoc.alertPreferences.email.unsubscribeToken;
  }
  if (!preferences.email.updatedAt) {
    preferences.email.updatedAt = memberDoc?.updatedAt || null;
  }
  return preferences;
};

const serializeMember = (memberDoc) => ({
  id: memberDoc?._id?.toString?.() || null,
  name: memberDoc?.name || '',
  email: memberDoc?.email || null,
  role: memberDoc?.role || null,
  active: Boolean(memberDoc?.active),
  avatarColor: memberDoc?.avatarColor || null,
  metadata: memberDoc?.metadata || {},
  alertPreferences: ensureAlertPreferences(memberDoc),
  createdAt: memberDoc?.createdAt || null,
  updatedAt: memberDoc?.updatedAt || null,
});

const ensureObject = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const normalizeTime = (value, fallback) => {
  if (typeof value === 'string' && TIME_PATTERN.test(value.trim())) {
    return value.trim();
  }
  return fallback;
};

const normalizeTimezone = (value, fallback = 'UTC') => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
};

const buildAlertPreferences = (input = {}) => {
  const email = input.email || {};
  const quietHours = email.quietHours || {};
  const digest = email.digest || {};

  return {
    email: {
      mode: ['immediate', 'digest', 'disabled'].includes(email.mode) ? email.mode : 'immediate',
      quietHours: {
        enabled: Boolean(quietHours.enabled),
        start: normalizeTime(quietHours.start, '22:00'),
        end: normalizeTime(quietHours.end, '07:00'),
        timezone: normalizeTimezone(quietHours.timezone, 'UTC'),
      },
      digest: {
        cadence: digest.cadence && typeof digest.cadence === 'string' ? digest.cadence : 'daily',
        lastSentAt: digest.lastSentAt || null,
      },
      unsubscribeToken: email.unsubscribeToken || null,
      updatedAt: email.updatedAt || null,
    },
  };
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const mergeAlertPreferences = (currentInput = {}, updateInput = {}) => {
  const current = buildAlertPreferences(currentInput);
  const normalizedUpdate = buildAlertPreferences(updateInput);

  const result = {
    email: {
      mode: current.email.mode,
      quietHours: { ...current.email.quietHours },
      digest: { ...current.email.digest },
      unsubscribeToken: current.email.unsubscribeToken || normalizedUpdate.email.unsubscribeToken,
      updatedAt: new Date(),
    },
  };

  if (updateInput.email && hasOwn(updateInput.email, 'mode')) {
    result.email.mode = normalizedUpdate.email.mode;
  }

  if (updateInput.email && updateInput.email.quietHours) {
    const updateQuietHours = updateInput.email.quietHours;
    if (hasOwn(updateQuietHours, 'enabled')) {
      result.email.quietHours.enabled = normalizedUpdate.email.quietHours.enabled;
    }
    if (hasOwn(updateQuietHours, 'start')) {
      result.email.quietHours.start = normalizedUpdate.email.quietHours.start;
    }
    if (hasOwn(updateQuietHours, 'end')) {
      result.email.quietHours.end = normalizedUpdate.email.quietHours.end;
    }
    if (hasOwn(updateQuietHours, 'timezone')) {
      result.email.quietHours.timezone = normalizedUpdate.email.quietHours.timezone;
    }
  }

  if (updateInput.email && updateInput.email.digest) {
    const updateDigest = updateInput.email.digest;
    if (hasOwn(updateDigest, 'cadence')) {
      result.email.digest.cadence = normalizedUpdate.email.digest.cadence;
    }
    if (hasOwn(updateDigest, 'lastSentAt')) {
      result.email.digest.lastSentAt = normalizedUpdate.email.digest.lastSentAt;
    }
  }

  return result;
};

const resolveRangeStart = (rangeKey) => {
  const now = new Date();
  const windowDays = RANGE_WINDOWS[rangeKey] || RANGE_WINDOWS['30d'];
  const start = new Date(now.getTime() - windowDays * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end: now, windowDays };
};

const baseMemberState = (memberDoc) => ({
  member: {
    id: memberDoc ? memberDoc._id.toString() : null,
    name: memberDoc?.name || 'Unassigned',
    email: memberDoc?.email || null,
    role: memberDoc?.role || null,
    active: memberDoc?.active ?? false,
    avatarColor: memberDoc?.avatarColor || null,
  },
  resolvedCount: 0,
  totalResolutionMs: 0,
  openAssignments: 0,
  assignmentsTouched: 0,
  avgResolutionMs: null,
});

const ensureMemberState = (map, memberDoc, memberId) => {
  const key = memberId || (memberDoc ? memberDoc._id.toString() : 'unassigned');
  if (!map.has(key)) {
    map.set(key, baseMemberState(memberDoc));
  }
  return map.get(key);
};

const listTeamMembers = async (project, options = {}) => {
  const filter = { projectId: project._id };
  if (!options.includeInactive) {
    filter.active = true;
  }
  const members = await TeamMember.find(filter).sort({ name: 1 }).lean();
  return members.map((member) => serializeMember(member));
};

const createTeamMember = async (project, payload = {}) => {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    const error = new Error('Name is required');
    error.status = 400;
    throw error;
  }

  const emailRaw = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!emailRaw || !emailRaw.includes('@')) {
    const error = new Error('A valid email is required');
    error.status = 400;
    throw error;
  }

  const role = typeof payload.role === 'string' && payload.role.trim().length ? payload.role.trim() : null;
  const color = typeof payload.avatarColor === 'string' && payload.avatarColor.trim().length
    ? payload.avatarColor.trim()
    : randomColor();

  try {
    const member = await TeamMember.create({
      projectId: project._id,
      name,
      email: emailRaw,
      role,
      active: payload.active !== false,
      avatarColor: color,
      metadata: ensureObject(payload.metadata),
    });
    return serializeMember(member);
  } catch (error) {
    if (error && error.code === 11000) {
      const conflict = new Error('A team member with this email already exists');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
};

const updateTeamMember = async (project, memberId, payload = {}) => {
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    return null;
  }

  const member = await TeamMember.findOne({ _id: memberId, projectId: project._id });
  if (!member) {
    return null;
  }

  if (payload.name !== undefined) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
      const error = new Error('Name must not be empty');
      error.status = 400;
      throw error;
    }
    member.name = name;
  }

  if (payload.email !== undefined) {
    const emailRaw = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!emailRaw || !emailRaw.includes('@')) {
      const error = new Error('A valid email is required');
      error.status = 400;
      throw error;
    }
    member.email = emailRaw;
  }

  if (payload.role !== undefined) {
    member.role = typeof payload.role === 'string' && payload.role.trim().length ? payload.role.trim() : null;
  }

  if (payload.active !== undefined) {
    member.active = Boolean(payload.active);
  }

  if (payload.avatarColor !== undefined) {
    member.avatarColor = typeof payload.avatarColor === 'string' && payload.avatarColor.trim().length
      ? payload.avatarColor.trim()
      : member.avatarColor;
  }

  if (payload.metadata !== undefined) {
    member.metadata = ensureObject(payload.metadata, member.metadata || {});
  }

  try {
    await member.save();
  } catch (error) {
    if (error && error.code === 11000) {
      const conflict = new Error('A team member with this email already exists');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }

  return serializeMember(member);
};

const deleteTeamMember = async (project, memberId) => {
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    return false;
  }

  const member = await TeamMember.findOne({ _id: memberId, projectId: project._id });
  if (!member) {
    return false;
  }

  if (!member.active) {
    return true;
  }

  member.active = false;
  await member.save();
  return true;
};

const collectErrorsForRange = async (project, rangeStart) => {
  const filters = [
    { resolvedAt: { $gte: rangeStart } },
    { lastSeen: { $gte: rangeStart } },
    { assignmentHistory: { $elemMatch: { assignedAt: { $gte: rangeStart } } } },
    { status: { $in: Array.from(ACTIVE_STATUSES) } },
  ];

  const query = {
    projectId: project._id,
    $or: filters,
  };

  return ErrorEvent.find(query)
    .select('message status assignedTo assignmentHistory resolvedAt firstSeen lastSeen count statusHistory')
    .lean();
};

const buildTimelineBuckets = (rangeStart, windowDays) => {
  const buckets = [];
  for (let index = 0; index < windowDays; index += 1) {
    const bucketStart = new Date(rangeStart.getTime() + index * DAY_MS);
    buckets.push({
      date: bucketStart.toISOString().slice(0, 10),
      resolvedCount: 0,
    });
  }
  return buckets;
};

const indexForDate = (rangeStart, date) => {
  const diff = date.getTime() - rangeStart.getTime();
  if (diff < 0) {
    return -1;
  }
  return Math.floor(diff / DAY_MS);
};

const computeTeamPerformance = async (project, options = {}) => {
  const rangeKey = ['7d', '30d', '90d'].includes(options.range) ? options.range : '30d';
  const { start: rangeStart, end: rangeEnd, windowDays } = resolveRangeStart(rangeKey);
  const members = await TeamMember.find({ projectId: project._id }).lean();
  const memberIndex = new Map();
  members.forEach((member) => {
    memberIndex.set(member._id.toString(), member);
  });

  const memberStats = new Map();
  members.forEach((member) => {
    ensureMemberState(memberStats, member, member._id.toString());
  });

  const errors = await collectErrorsForRange(project, rangeStart);
  const timeline = buildTimelineBuckets(rangeStart, windowDays);
  const resolutionSamples = [];

  let activeAssignments = 0;
  let unassignedActive = 0;
  let resolvedThisRange = 0;

  const backlogPreview = [];

  errors.forEach((errorDoc) => {
    const currentStatus = errorDoc.status;
    const assignedTo = errorDoc.assignedTo ? errorDoc.assignedTo.toString() : null;

    if (ACTIVE_STATUSES.has(currentStatus)) {
      if (assignedTo) {
        const memberDoc = memberIndex.get(assignedTo) || null;
        const state = ensureMemberState(memberStats, memberDoc, assignedTo);
        state.openAssignments += 1;
        activeAssignments += 1;
      } else {
        unassignedActive += 1;
      }
    }

    const assignments = Array.isArray(errorDoc.assignmentHistory) ? errorDoc.assignmentHistory : [];
    assignments.forEach((entry) => {
      if (!entry?.memberId) {
        return;
      }
      const memberId = entry.memberId.toString();
      const assignedAt = entry.assignedAt ? new Date(entry.assignedAt) : null;
      const unassignedAt = entry.unassignedAt ? new Date(entry.unassignedAt) : null;

      if (assignedAt && assignedAt < rangeStart && (!unassignedAt || unassignedAt < rangeStart)) {
        return;
      }

      const memberDoc = memberIndex.get(memberId) || null;
      const state = ensureMemberState(memberStats, memberDoc, memberId);
      state.assignmentsTouched += 1;
    });

    if (errorDoc.resolvedAt) {
      const resolvedAt = new Date(errorDoc.resolvedAt);
      if (!Number.isNaN(resolvedAt.getTime()) && resolvedAt >= rangeStart && resolvedAt <= rangeEnd) {
        resolvedThisRange += 1;
        const timelineIndex = indexForDate(rangeStart, resolvedAt);
        if (timelineIndex >= 0 && timelineIndex < timeline.length) {
          timeline[timelineIndex].resolvedCount += 1;
        }

        let creditedMemberId = null;
        let resolutionMs = null;
        const relevantAssignments = assignments.filter((entry) => Boolean(entry?.memberId));

        const coveringAssignment = relevantAssignments.find((entry) => {
          const assignedAt = entry.assignedAt ? new Date(entry.assignedAt) : null;
          const unassignedAt = entry.unassignedAt ? new Date(entry.unassignedAt) : null;
          const startsBefore = !assignedAt || assignedAt <= resolvedAt;
          const endsAfter = !unassignedAt || unassignedAt >= resolvedAt;
          return startsBefore && endsAfter;
        });

        const targetAssignment = coveringAssignment || relevantAssignments[relevantAssignments.length - 1] || null;

        if (targetAssignment) {
          creditedMemberId = targetAssignment.memberId.toString();
          const assignedAt = targetAssignment.assignedAt ? new Date(targetAssignment.assignedAt) : null;
          if (assignedAt && !Number.isNaN(assignedAt.getTime())) {
            resolutionMs = Math.max(0, resolvedAt.getTime() - assignedAt.getTime());
          }
        }

        if (resolutionMs === null && errorDoc.firstSeen) {
          const firstSeen = new Date(errorDoc.firstSeen);
          if (!Number.isNaN(firstSeen.getTime())) {
            resolutionMs = Math.max(0, resolvedAt.getTime() - firstSeen.getTime());
          }
        }

        if (resolutionMs !== null) {
          resolutionSamples.push(resolutionMs);
        }

        if (creditedMemberId) {
          const memberDoc = memberIndex.get(creditedMemberId) || null;
          const state = ensureMemberState(memberStats, memberDoc, creditedMemberId);
          state.resolvedCount += 1;
          if (resolutionMs !== null) {
            state.totalResolutionMs += resolutionMs;
          }
        }
      }
    }

    if (ACTIVE_STATUSES.has(currentStatus) && !assignedTo && backlogPreview.length < 5) {
      backlogPreview.push({
        id: errorDoc._id?.toString?.() || null,
        message: errorDoc.message || 'Unknown error',
        lastSeen: errorDoc.lastSeen || null,
        count: errorDoc.count || 0,
      });
    }
  });

  const leaderboard = Array.from(memberStats.values())
    .map((entry) => {
      if (entry.resolvedCount > 0 && entry.totalResolutionMs > 0) {
        entry.avgResolutionMs = entry.totalResolutionMs / entry.resolvedCount;
      }
      const score = entry.resolvedCount * 5 + entry.openAssignments * -1 + (entry.assignmentsTouched || 0);
      return {
        member: entry.member,
        resolvedCount: entry.resolvedCount,
        avgResolutionMs: entry.avgResolutionMs,
        openAssignments: entry.openAssignments,
        assignmentsTouched: entry.assignmentsTouched,
        score,
      };
    })
    .sort((a, b) => {
      if (b.resolvedCount === a.resolvedCount) {
        const aAvg = a.avgResolutionMs ?? Number.POSITIVE_INFINITY;
        const bAvg = b.avgResolutionMs ?? Number.POSITIVE_INFINITY;
        if (aAvg === bAvg) {
          return b.score - a.score;
        }
        return aAvg - bAvg;
      }
      return b.resolvedCount - a.resolvedCount;
    });

  const teamAverage = resolutionSamples.length
    ? resolutionSamples.reduce((total, value) => total + value, 0) / resolutionSamples.length
    : null;

  return {
    range: {
      key: rangeKey,
      start: rangeStart.toISOString(),
      end: rangeEnd.toISOString(),
      days: windowDays,
    },
    totals: {
      teamSize: members.length,
      activeAssignments,
      unassignedActive,
      resolved: resolvedThisRange,
      avgResolutionMs: teamAverage,
    },
    leaderboard,
    timeline,
    backlogPreview,
  };
};

const getTeamMemberById = async (project, memberId) => {
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    return null;
  }
  const member = await TeamMember.findOne({ _id: memberId, projectId: project._id }).lean();
  if (!member) {
    return null;
  }
  return serializeMember(member);
};

const getTeamMemberAlertPreferences = async (project, memberId) => {
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    return null;
  }

  const member = await TeamMember.findOne({ _id: memberId, projectId: project._id }).lean();
  if (!member) {
    return null;
  }

  return {
    member: {
      id: member._id.toString(),
      name: member.name,
      email: member.email,
    },
    preferences: ensureAlertPreferences(member),
  };
};

const updateTeamMemberAlertPreferences = async (project, memberId, payload = {}) => {
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    return null;
  }

  const member = await TeamMember.findOne({ _id: memberId, projectId: project._id });
  if (!member) {
    return null;
  }

  const merged = mergeAlertPreferences(member.alertPreferences, payload);
  member.alertPreferences = merged;
  member.markModified('alertPreferences');
  await member.save();

  return {
    member: {
      id: member._id.toString(),
      name: member.name,
      email: member.email,
    },
    preferences: ensureAlertPreferences(member.toObject()),
  };
};

module.exports = {
  listTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  computeTeamPerformance,
  getTeamMemberById,
  getTeamMemberAlertPreferences,
  updateTeamMemberAlertPreferences,
};

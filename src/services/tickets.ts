import { randomUUID } from "node:crypto";
import { getDatabase } from "../database/connection.js";

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface TicketRecord {
  ticketId: string;
  guildId: string;
  channelId: string;
  openerUserId: string;
  status: "open" | "closed";
  subject: string | null;
  category: string;
  priority: TicketPriority;
  assignedStaffId: string | null;
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
}

interface TicketRow {
  ticket_id: string;
  guild_id: string;
  channel_id: string;
  opener_user_id: string;
  status: "open" | "closed";
  subject: string | null;
  category: string;
  priority: TicketPriority;
  assigned_staff_id: string | null;
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: string | null;
}

function mapTicket(row: TicketRow): TicketRecord {
  return {
    ticketId: row.ticket_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    openerUserId: row.opener_user_id,
    status: row.status,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    assignedStaffId: row.assigned_staff_id,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    closeReason: row.close_reason,
  };
}

function getTicket(ticketId: string): TicketRecord | undefined {
  const row = getDatabase().prepare("SELECT * FROM tickets WHERE ticket_id = ?").get(ticketId) as
    TicketRow | undefined;
  return row ? mapTicket(row) : undefined;
}

function recordStaffActivity(ticketId: string, staffUserId: string, action: string): void {
  getDatabase()
    .prepare(
      "INSERT INTO ticket_staff_activity (ticket_id, staff_user_id, action, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(ticketId, staffUserId, action, new Date().toISOString());
}

export function reserveTicket(guildId: string, openerUserId: string): string | undefined {
  const db = getDatabase();
  const ticketId = randomUUID();
  return db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(guildId);
    db.prepare("DELETE FROM ticket_reservations WHERE expires_at <= ?").run(Date.now());
    const active = db
      .prepare(
        "SELECT ticket_id FROM tickets WHERE guild_id = ? AND opener_user_id = ? AND status = 'open'",
      )
      .get(guildId, openerUserId);
    const pending = db
      .prepare(
        "SELECT ticket_id FROM ticket_reservations WHERE guild_id = ? AND opener_user_id = ?",
      )
      .get(guildId, openerUserId);
    if (active || pending) return undefined;
    db.prepare(
      `
      INSERT INTO ticket_reservations (guild_id, opener_user_id, ticket_id, expires_at)
      VALUES (?, ?, ?, ?)
    `,
    ).run(guildId, openerUserId, ticketId, Date.now() + 5 * 60_000);
    return ticketId;
  })();
}

export function cancelTicketReservation(ticketId: string): void {
  getDatabase().prepare("DELETE FROM ticket_reservations WHERE ticket_id = ?").run(ticketId);
}

export function registerOpenTicket(input: {
  ticketId: string;
  guildId: string;
  channelId: string;
  openerUserId: string;
  subject: string | null;
  category: string;
}): TicketRecord {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(input.guildId);
    db.prepare(
      `
      INSERT INTO tickets
        (ticket_id, guild_id, channel_id, opener_user_id, status, created_at, subject, category)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
    `,
    ).run(
      input.ticketId,
      input.guildId,
      input.channelId,
      input.openerUserId,
      new Date().toISOString(),
      input.subject,
      input.category,
    );
    db.prepare("DELETE FROM ticket_reservations WHERE ticket_id = ?").run(input.ticketId);
    recordStaffActivity(input.ticketId, input.openerUserId, "opened");
  })();
  const ticket = getTicket(input.ticketId);
  if (!ticket) throw new Error("Ticket record could not be loaded after creation.");
  return ticket;
}

export function registerExistingTicket(input: {
  guildId: string;
  channelId: string;
  openerUserId: string;
  status?: "open" | "closed";
}): TicketRecord {
  const db = getDatabase();
  const existing = db
    .prepare("SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?")
    .get(input.guildId, input.channelId) as TicketRow | undefined;
  if (existing) return mapTicket(existing);

  const active = db
    .prepare("SELECT * FROM tickets WHERE guild_id = ? AND opener_user_id = ? AND status = 'open'")
    .get(input.guildId, input.openerUserId) as TicketRow | undefined;
  if (active) {
    if (active.channel_id === input.channelId) return mapTicket(active);
    throw new Error("The member already has a different open ticket.");
  }

  const ticketId = randomUUID();
  const status = input.status ?? "open";
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(input.guildId);
    db.prepare(
      `
      INSERT INTO tickets (ticket_id, guild_id, channel_id, opener_user_id, status, created_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      ticketId,
      input.guildId,
      input.channelId,
      input.openerUserId,
      status,
      new Date().toISOString(),
      status === "closed" ? new Date().toISOString() : null,
    );
    recordStaffActivity(ticketId, input.openerUserId, "imported_from_channel");
  })();
  const ticket = getTicket(ticketId);
  if (!ticket) throw new Error("Existing ticket record could not be loaded.");
  return ticket;
}

export function findOpenTicket(guildId: string, openerUserId: string): TicketRecord | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM tickets WHERE guild_id = ? AND opener_user_id = ? AND status = 'open'")
    .get(guildId, openerUserId) as TicketRow | undefined;
  return row ? mapTicket(row) : undefined;
}

export function findTicketByChannel(guildId: string, channelId: string): TicketRecord | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?")
    .get(guildId, channelId) as TicketRow | undefined;
  return row ? mapTicket(row) : undefined;
}

export function claimTicket(ticket: TicketRecord, staffUserId: string): void {
  const db = getDatabase();
  db.transaction(() => {
    const result = db
      .prepare("UPDATE tickets SET assigned_staff_id = ? WHERE ticket_id = ? AND status = 'open'")
      .run(staffUserId, ticket.ticketId);
    if (result.changes === 0) throw new Error("This ticket is no longer open.");
    recordStaffActivity(ticket.ticketId, staffUserId, "claimed");
  })();
}

export function assignTicket(ticket: TicketRecord, actorUserId: string, staffUserId: string): void {
  const db = getDatabase();
  db.transaction(() => {
    const result = db
      .prepare("UPDATE tickets SET assigned_staff_id = ? WHERE ticket_id = ? AND status = 'open'")
      .run(staffUserId, ticket.ticketId);
    if (result.changes === 0) throw new Error("This ticket is no longer open.");
    recordStaffActivity(ticket.ticketId, actorUserId, `assigned:${staffUserId}`);
  })();
}

export function setTicketPriority(
  ticket: TicketRecord,
  staffUserId: string,
  priority: TicketPriority,
): void {
  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    throw new Error("Invalid ticket priority.");
  }
  const db = getDatabase();
  db.transaction(() => {
    const result = db
      .prepare("UPDATE tickets SET priority = ? WHERE ticket_id = ? AND status = 'open'")
      .run(priority, ticket.ticketId);
    if (result.changes === 0) throw new Error("This ticket is no longer open.");
    recordStaffActivity(ticket.ticketId, staffUserId, `priority:${priority}`);
  })();
}

export function closeTicketRecord(ticket: TicketRecord, staffUserId: string, reason: string): void {
  const db = getDatabase();
  db.transaction(() => {
    const result = db
      .prepare(
        `
        UPDATE tickets
        SET status = 'closed', closed_at = ?, closed_by = ?, close_reason = ?
        WHERE ticket_id = ? AND status = 'open'
      `,
      )
      .run(new Date().toISOString(), staffUserId, reason, ticket.ticketId);
    if (result.changes === 0) throw new Error("This ticket is no longer open.");
    recordStaffActivity(ticket.ticketId, staffUserId, "closed");
  })();
}

export function reopenTicketRecord(ticket: TicketRecord, staffUserId: string): void {
  const db = getDatabase();
  db.transaction(() => {
    const active = db
      .prepare(
        `
        SELECT ticket_id FROM tickets
        WHERE guild_id = ? AND opener_user_id = ? AND status = 'open' AND ticket_id != ?
      `,
      )
      .get(ticket.guildId, ticket.openerUserId, ticket.ticketId);
    if (active) throw new Error("The opener already has another open ticket.");
    const result = db
      .prepare(
        `
        UPDATE tickets
        SET status = 'open', closed_at = NULL, closed_by = NULL, close_reason = NULL
        WHERE ticket_id = ? AND status = 'closed'
      `,
      )
      .run(ticket.ticketId);
    if (result.changes === 0) throw new Error("This ticket is already open.");
    recordStaffActivity(ticket.ticketId, staffUserId, "reopened");
  })();
}

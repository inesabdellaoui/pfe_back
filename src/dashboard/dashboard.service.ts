import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as nodemailer from 'nodemailer';

@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async getKpis() {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(*)::int AS total_inspections,

        COUNT(*) FILTER (WHERE result = 'OK')::int AS pieces_ok,

        COUNT(*) FILTER (WHERE result = 'NIO')::int AS pieces_nio,

        ROUND(
          (
            COUNT(*) FILTER (WHERE result = 'NIO')::numeric
            / NULLIF(COUNT(*), 0)
          ) * 100,
          2
        ) AS mdr,
    `);

    const row = result[0];

    return {
      totalInspections: row.total_inspections,
      piecesOK: row.pieces_ok,
      piecesNIO: row.pieces_nio,
      mdr: Number(row.mdr ?? 0),
      coutScrap: row.cout_scrap,
    };
  }
  async getInspectionsTrend() {
  return this.dataSource.query(`
    SELECT
      TO_CHAR(date_inspection::date, 'DD/MM') AS date,
      COUNT(*) FILTER (WHERE result = 'OK')::int AS ok,
      COUNT(*) FILTER (WHERE result = 'NIO')::int AS nio
    FROM inspection
    GROUP BY date_inspection::date
    ORDER BY date_inspection::date;
  `);
}

async getTopLots() {
  return this.dataSource.query(`
    SELECT
      l.id_lot AS lot,
      c.nom_client AS client,
      ROUND(
        (
          COUNT(*) FILTER (WHERE i.result = 'NIO')::numeric
          / NULLIF(COUNT(*), 0)
        ) * 100,
        2
      ) AS mdr
    FROM lot l
    JOIN client c ON c.id_client = l.id_client
    JOIN piece p ON p.id_lot = l.id_lot
    JOIN inspection i ON i.id_piece = p.id_piece
    GROUP BY l.id_lot, c.nom_client
    ORDER BY mdr DESC
    LIMIT 5;
  `);
}
async getDefectsDistribution() {
  return this.dataSource.query(`
    SELECT
      d.type_defaut AS type,
      COUNT(*) AS total
    FROM defaut d
    JOIN inspection i ON i.id_inspection = d.id_inspection
    GROUP BY d.type_defaut
    ORDER BY total DESC;
  `);
}

async getKpisFiltered(filters: any) {
  const { client, startDate, endDate } = filters;

  let where = `WHERE 1=1`;

  if (client) {
    where += ` AND c.id_client = '${client}'`;
  }

  if (startDate && endDate) {
    where += ` AND i.date_inspection BETWEEN '${startDate}' AND '${endDate}'`;
  }

  const result = await this.dataSource.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE i.result = 'OK') AS ok,
      COUNT(*) FILTER (WHERE i.result = 'NIO') AS nio
    FROM inspection i
    JOIN piece p ON p.id_piece = i.id_piece
    JOIN lot l ON l.id_lot = p.id_lot
    JOIN client c ON c.id_client = l.id_client
    ${where}
  `);

  return result[0];
}

  // ─── PERFORMANCES ───────────────────────────────────────────

  async getPerfKpis() {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(i.id_inspection)                                        AS total_inspections,
        ROUND(COUNT(i.id_inspection)::numeric /
              NULLIF(EXTRACT(EPOCH FROM (MAX(i.date_inspection) - MIN(i.date_inspection)))/3600, 0), 1)
                                                                      AS cadence_par_heure,
        ROUND(
          COUNT(CASE WHEN i.result = 'OK' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1)                 AS taux_conformite,
        ROUND(AVG(EXTRACT(EPOCH FROM (i.date_inspection - l.date_reception))/3600)::numeric, 1)
                                                                      AS delai_moyen_heures
      FROM inspection i
      JOIN piece p   ON p.id_piece = i.id_piece
      JOIN lot l     ON l.id_lot   = p.id_lot
    `);
    return result[0];
  }

  async getPerfTrend() {
    return this.dataSource.query(`
      SELECT
        TO_CHAR(date_inspection, 'DD/MM')          AS date,
        COUNT(*)                                    AS total,
        COUNT(CASE WHEN result = 'OK'  THEN 1 END) AS ok,
        COUNT(CASE WHEN result = 'NIO' THEN 1 END) AS nio
      FROM inspection
      GROUP BY TO_CHAR(date_inspection, 'DD/MM'), DATE_TRUNC('day', date_inspection)
      ORDER BY DATE_TRUNC('day', date_inspection) DESC
      LIMIT 14
    `);
  }

  async getPerfByClient() {
    return this.dataSource.query(`
      SELECT
        c.nom_client                                            AS client,
        COUNT(i.id_inspection)                                  AS total,
        COUNT(CASE WHEN i.result = 'OK'  THEN 1 END)           AS ok,
        COUNT(CASE WHEN i.result = 'NIO' THEN 1 END)           AS nio,
        ROUND(
          COUNT(CASE WHEN i.result = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1)           AS mdr
      FROM inspection i
      JOIN piece p ON p.id_piece = i.id_piece
      JOIN lot   l ON l.id_lot   = p.id_lot
      JOIN client c ON c.id_client = l.id_client
      GROUP BY c.nom_client
      ORDER BY total DESC
    `);
  }

  async getPerfByOperatrice() {
    return this.dataSource.query(`
      SELECT
        u.prenom || ' ' || u.nom                               AS operatrice,
        u.role,
        COUNT(i.id_inspection)                                  AS total,
        COUNT(CASE WHEN i.result = 'OK'  THEN 1 END)           AS ok,
        COUNT(CASE WHEN i.result = 'NIO' THEN 1 END)           AS nio,
        ROUND(
          COUNT(CASE WHEN i.result = 'OK' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1)           AS taux_ok
      FROM inspection i
      JOIN users u ON u.id_client = (
        SELECT l.id_client FROM piece p
        JOIN lot l ON l.id_lot = p.id_lot
        WHERE p.id_piece = i.id_piece
        LIMIT 1
      )
      GROUP BY u.prenom, u.nom, u.role
      ORDER BY total DESC
      LIMIT 10
    `);
  }

  // ─── ANALYSE PAR LOT ─────────────────────────────────────────

  async getLotsKpis() {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(DISTINCT l.id_lot)                                     AS total_lots,
        COUNT(DISTINCT CASE
          WHEN (
            SELECT COUNT(*) FROM piece p2
            JOIN inspection i2 ON i2.id_piece = p2.id_piece
            WHERE p2.id_lot = l.id_lot AND i2.result = 'NIO'
          )::numeric /
          NULLIF((
            SELECT COUNT(*) FROM piece p3
            JOIN inspection i3 ON i3.id_piece = p3.id_piece
            WHERE p3.id_lot = l.id_lot
          ), 0) * 100 > 15
          THEN l.id_lot END)                                         AS lots_critiques,
        ROUND(AVG(
          (SELECT COUNT(*) FROM piece p4
           JOIN inspection i4 ON i4.id_piece = p4.id_piece
           WHERE p4.id_lot = l.id_lot AND i4.result = 'NIO')::numeric /
          NULLIF((
            SELECT COUNT(*) FROM piece p5
            JOIN inspection i5 ON i5.id_piece = p5.id_piece
            WHERE p5.id_lot = l.id_lot
          ), 0) * 100
        ), 1)                                                        AS mdr_moyen
      FROM lot l
    `);
    return result[0];
  }

  async getLotsList(client?: string, statut?: string, startDate?: string, endDate?: string) {
    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (client) {
      where += ` AND c.id_client = $${idx++}`;
      params.push(client);
    }
    if (statut) {
      where += ` AND l.statut_lot = $${idx++}`;
      params.push(statut);
    }
    if (startDate) {
      where += ` AND l.date_reception >= $${idx++}`;
      params.push(startDate);
    }
    if (endDate) {
      where += ` AND l.date_reception <= $${idx++}`;
      params.push(endDate);
    }

    return this.dataSource.query(`
      SELECT
        l.id_lot,
        c.nom_client                                              AS client,
        l.date_reception,
        l.statut_lot,
        COUNT(DISTINCT p.id_piece)                               AS total_pieces,
        COUNT(CASE WHEN i.result = 'OK'  THEN 1 END)            AS ok,
        COUNT(CASE WHEN i.result = 'NIO' THEN 1 END)            AS nio,
        ROUND(
          COUNT(CASE WHEN i.result = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1)            AS mdr
      FROM lot l
      JOIN client c    ON c.id_client  = l.id_client
      LEFT JOIN piece p ON p.id_lot    = l.id_lot
      LEFT JOIN inspection i ON i.id_piece = p.id_piece
      ${where}
      GROUP BY l.id_lot, c.nom_client, l.date_reception, l.statut_lot
      ORDER BY l.date_reception DESC
      LIMIT 50
    `, params);
  }

  async getLotsTopProblematic() {
    return this.dataSource.query(`
      SELECT
        l.id_lot,
        c.nom_client                                              AS client,
        l.date_reception,
        l.statut_lot,
        COUNT(CASE WHEN i.result = 'NIO' THEN 1 END)            AS nio,
        COUNT(i.id_inspection)                                   AS total,
        ROUND(
          COUNT(CASE WHEN i.result = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1)            AS mdr
      FROM lot l
      JOIN client c    ON c.id_client  = l.id_client
      LEFT JOIN piece p ON p.id_lot    = l.id_lot
      LEFT JOIN inspection i ON i.id_piece = p.id_piece
      GROUP BY l.id_lot, c.nom_client, l.date_reception, l.statut_lot
      HAVING COUNT(i.id_inspection) > 0
      ORDER BY mdr DESC
      LIMIT 5
    `);
  }

  async getLotDetail(idLot: string) {
    const [lot] = await this.dataSource.query(`
      SELECT
        l.id_lot, c.nom_client AS client,
        l.date_reception, l.date_production, l.statut_lot,
        COUNT(DISTINCT p.id_piece)                               AS total_pieces,
        COUNT(CASE WHEN i.result = 'OK'  THEN 1 END)            AS ok,
        COUNT(CASE WHEN i.result = 'NIO' THEN 1 END)            AS nio,
        ROUND(
          COUNT(CASE WHEN i.result = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1)            AS mdr
      FROM lot l
      JOIN client c    ON c.id_client  = l.id_client
      LEFT JOIN piece p ON p.id_lot    = l.id_lot
      LEFT JOIN inspection i ON i.id_piece = p.id_piece
      WHERE l.id_lot = $1
      GROUP BY l.id_lot, c.nom_client, l.date_reception, l.date_production, l.statut_lot
    `, [idLot]);

    const defects = await this.dataSource.query(`
      SELECT d.type_defaut, d.gravite, COUNT(*) AS total
      FROM defaut d
      JOIN inspection i ON i.id_inspection = d.id_inspection
      JOIN piece p      ON p.id_piece      = i.id_piece
      WHERE p.id_lot = $1
      GROUP BY d.type_defaut, d.gravite
      ORDER BY total DESC
    `, [idLot]);

    return { ...lot, defects };
  }


// Ajouter dans dashboard.service.ts

// ─── TRAÇABILITÉ ──────────────────────────────────────

async searchPieces(filters: any) {
  let where = 'WHERE 1=1';
  const params: any[] = [];
  let idx = 1;

  if (filters.q) {
    where += ` AND (p.id_piece::text ILIKE $${idx} OR p.reference_piece ILIKE $${idx})`;
    params.push(`%${filters.q}%`); idx++;
  }
  if (filters.client) {
    where += ` AND c.id_client = $${idx++}`;
    params.push(filters.client);
  }
  if (filters.lot) {
    where += ` AND l.id_lot ILIKE $${idx++}`;
    params.push(`%${filters.lot}%`);
  }
  if (filters.result) {
    where += ` AND i.result = $${idx++}`;
    params.push(filters.result);
  }
  if (filters.startDate) {
    where += ` AND i.date_inspection >= $${idx++}`;
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    where += ` AND i.date_inspection <= $${idx++}`;
    params.push(filters.endDate);
  }

  return this.dataSource.query(`
    SELECT
      p.id_piece,
      p.reference_piece,
      p.nom_piece,
      p.type_piece,
      l.id_lot,
      c.nom_client          AS client,
      i.id_inspection,
      i.date_inspection,
      i.result,
      i.confidence,
      i.image_path,
      COUNT(d.id_defaut)    AS nb_defauts
    FROM piece p
    JOIN lot l         ON l.id_lot        = p.id_lot
    JOIN client c      ON c.id_client     = l.id_client
    LEFT JOIN inspection i ON i.id_piece  = p.id_piece
    LEFT JOIN defaut d     ON d.id_inspection = i.id_inspection
    ${where}
    GROUP BY p.id_piece, p.reference_piece, p.nom_piece, p.type_piece,
             l.id_lot, c.nom_client, i.id_inspection,
             i.date_inspection, i.result, i.confidence, i.image_path
    ORDER BY i.date_inspection DESC
    LIMIT 100
  `, params);
}

async getPieceDetail(id: string) {
  const [piece] = await this.dataSource.query(`
    SELECT
      p.id_piece, p.reference_piece, p.nom_piece, p.type_piece,
      l.id_lot, l.date_reception, l.statut_lot,
      c.nom_client          AS client,
      i.id_inspection, i.date_inspection, i.result,
      i.confidence, i.image_path,
      i.bbox_x, i.bbox_y, i.bbox_w, i.bbox_h,
      i.model_version
    FROM piece p
    JOIN lot l         ON l.id_lot        = p.id_lot
    JOIN client c      ON c.id_client     = l.id_client
    LEFT JOIN inspection i ON i.id_piece  = p.id_piece
    WHERE p.id_piece = $1
    ORDER BY i.date_inspection DESC
    LIMIT 1
  `, [id]);

  const defauts = await this.dataSource.query(`
    SELECT d.type_defaut, d.gravite, COUNT(*) AS total
    FROM defaut d
    JOIN inspection i ON i.id_inspection = d.id_inspection
    WHERE i.id_piece = $1
    GROUP BY d.type_defaut, d.gravite
    ORDER BY total DESC
  `, [id]);

  return { ...piece, defauts };
}

// ─── IMAGES NIO ───────────────────────────────────────

async getNioImages(filters: any) {
  let where = `WHERE i.result = 'NIO' AND i.image_path IS NOT NULL`;
  const params: any[] = [];
  let idx = 1;

  if (filters.client) {
    where += ` AND c.id_client = $${idx++}`;
    params.push(filters.client);
  }
  if (filters.defect) {
    where += ` AND EXISTS (SELECT 1 FROM defaut d2 WHERE d2.id_inspection = i.id_inspection AND d2.type_defaut = $${idx++})`;
    params.push(filters.defect);
  }
  if (filters.lot) {
    where += ` AND l.id_lot ILIKE $${idx++}`;
    params.push(`%${filters.lot}%`);
  }

  return this.dataSource.query(`
    SELECT
      i.id_inspection,
      i.id_piece,
      p.reference_piece,
      l.id_lot,
      c.nom_client          AS client,
      i.date_inspection,
      i.confidence,
      i.image_path,
      STRING_AGG(DISTINCT d.type_defaut, ', ') AS defauts,
      STRING_AGG(DISTINCT d.gravite, ', ')     AS gravites,
      COUNT(d.id_defaut)                       AS nb_defauts
    FROM inspection i
    JOIN piece p   ON p.id_piece   = i.id_piece
    JOIN lot l     ON l.id_lot     = p.id_lot
    JOIN client c  ON c.id_client  = l.id_client
    LEFT JOIN defaut d ON d.id_inspection = i.id_inspection
    ${where}
    GROUP BY i.id_inspection, i.id_piece, p.reference_piece,
             l.id_lot, c.nom_client, i.date_inspection,
             i.confidence, i.image_path
    ORDER BY i.date_inspection DESC
    LIMIT 200
  `, params);
}

async getNioImageDetail(id: string) {
  const [inspection] = await this.dataSource.query(`
    SELECT
      i.id_inspection, i.id_piece,
      p.reference_piece, p.nom_piece, p.type_piece,
      l.id_lot, l.date_reception,
      c.nom_client AS client,
      i.date_inspection, i.result, i.confidence,
      i.image_path, i.bbox_x, i.bbox_y, i.bbox_w, i.bbox_h,
      i.model_version
    FROM inspection i
    JOIN piece p  ON p.id_piece  = i.id_piece
    JOIN lot l    ON l.id_lot    = p.id_lot
    JOIN client c ON c.id_client = l.id_client
    WHERE i.id_inspection = $1
  `, [id]);

  const defauts = await this.dataSource.query(`
    SELECT type_defaut, gravite
    FROM defaut
    WHERE id_inspection = $1
    ORDER BY gravite DESC
  `, [id]);

  return { ...inspection, defauts };
}

// ─── RAPPORT ──────────────────────────────────────────

async getPieceRapport(id: string) {
  // Retourne toutes les infos pour générer le rapport complet
  return this.getPieceDetail(id);
}


// dashboard.service.ts — installer d'abord : npm install @nestjs-modules/mailer nodemailer

async sendRapportMail(pieceId: string, email: string) {
  const rapport = await this.getPieceRapport(pieceId);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"CuirQuality" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Rapport d'inspection — Pièce ${rapport.reference_piece}`,
    html: `
      <h2>Rapport d'inspection DRÄXLMAIER</h2>
      <p><strong>Pièce :</strong> ${rapport.reference_piece}</p>
      <p><strong>Résultat :</strong> ${rapport.result}</p>
      <p><strong>Lot :</strong> ${rapport.id_lot}</p>
      <p><strong>Client :</strong> ${rapport.client}</p>
      <p><strong>Date :</strong> ${rapport.date_inspection}</p>
      <p>Consultez le dashboard pour les détails complets.</p>
    `,
  });

  return { success: true };
}






}
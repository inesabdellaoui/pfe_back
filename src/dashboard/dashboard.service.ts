import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as nodemailer from 'nodemailer';

@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async getKpis() {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(*)::int AS total_inspections,
        COUNT(*) FILTER (WHERE resultat = 'OK')::int  AS pieces_ok,
        COUNT(*) FILTER (WHERE resultat = 'NIO')::int AS pieces_nio,
        ROUND(
          COUNT(*) FILTER (WHERE resultat = 'NIO')::numeric
          / NULLIF(COUNT(*), 0) * 100, 2
        ) AS mdr
      FROM public.inspection
    `);
    const row = result[0];
    return {
      totalInspections: row.total_inspections,
      piecesOK:         row.pieces_ok,
      piecesNIO:        row.pieces_nio,
      mdr:              Number(row.mdr ?? 0),
    };
  }

  async getInspectionsTrend() {
    return this.dataSource.query(`
      SELECT
        TO_CHAR(date_inspection::date, 'DD/MM') AS date,
        COUNT(*) FILTER (WHERE resultat = 'OK')::int  AS ok,
        COUNT(*) FILTER (WHERE resultat = 'NIO')::int AS nio
      FROM public.inspection
      GROUP BY date_inspection::date
      ORDER BY date_inspection::date
    `);
  }

  async getTopLots() {
    return this.dataSource.query(`
      SELECT
        l.id_lot    AS lot,
        c.nom_client AS client,
        ROUND(
          COUNT(*) FILTER (WHERE i.resultat = 'NIO')::numeric
          / NULLIF(COUNT(*), 0) * 100, 2
        ) AS mdr
      FROM public.lot l
      JOIN public.client c     ON c.id_client = l.id_client
      JOIN public.piece p      ON p.id_lot    = l.id_lot
      JOIN public.inspection i ON i.id_piece  = p.id_piece
      GROUP BY l.id_lot, c.nom_client
      ORDER BY mdr DESC
      LIMIT 5
    `);
  }

  async getDefectsDistribution() {
    return this.dataSource.query(`
      SELECT d.type_defaut AS type, COUNT(*) AS total
      FROM public.defaut d
      JOIN public.inspection i ON i.id_inspection = d.id_inspection
      GROUP BY d.type_defaut
      ORDER BY total DESC
    `);
  }

  async getKpisFiltered(filters: any) {
    const { client, startDate, endDate } = filters;
    let where = 'WHERE 1=1';
    if (client)                  where += ` AND c.id_client = '${client}'`;
    if (startDate && endDate)    where += ` AND i.date_inspection BETWEEN '${startDate}' AND '${endDate}'`;

    const result = await this.dataSource.query(`
      SELECT
        COUNT(*)                                         AS total,
        COUNT(*) FILTER (WHERE i.resultat = 'OK')        AS ok,
        COUNT(*) FILTER (WHERE i.resultat = 'NIO')       AS nio
      FROM public.inspection i
      JOIN public.piece p  ON p.id_piece  = i.id_piece
      JOIN public.lot l    ON l.id_lot    = p.id_lot
      JOIN public.client c ON c.id_client = l.id_client
      ${where}
    `);
    return result[0];
  }

  // ─── PERFORMANCES ────────────────────────────────────────────

  async getPerfKpis() {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(i.id_inspection) AS total_inspections,
        ROUND(
          COUNT(i.id_inspection)::numeric /
          NULLIF(EXTRACT(EPOCH FROM (MAX(i.date_inspection) - MIN(i.date_inspection)))/3600, 0)
        , 1) AS cadence_par_heure,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'OK' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS taux_conformite,
        ROUND(
          AVG(EXTRACT(EPOCH FROM (i.date_inspection - l.date_reception))/3600)::numeric
        , 1) AS delai_moyen_heures
      FROM public.inspection i
      JOIN public.piece p ON p.id_piece = i.id_piece
      JOIN public.lot l   ON l.id_lot   = p.id_lot
    `);
    return result[0];
  }

  async getPerfTrend() {
    return this.dataSource.query(`
      SELECT
        TO_CHAR(date_inspection, 'DD/MM')                    AS date,
        COUNT(*)                                              AS total,
        COUNT(CASE WHEN resultat = 'OK'  THEN 1 END)         AS ok,
        COUNT(CASE WHEN resultat = 'NIO' THEN 1 END)         AS nio
      FROM public.inspection
      GROUP BY TO_CHAR(date_inspection, 'DD/MM'), DATE_TRUNC('day', date_inspection)
      ORDER BY DATE_TRUNC('day', date_inspection) DESC
      LIMIT 14
    `);
  }

  async getPerfByClient() {
    return this.dataSource.query(`
      SELECT
        c.nom_client                                          AS client,
        COUNT(i.id_inspection)                                AS total,
        COUNT(CASE WHEN i.resultat = 'OK'  THEN 1 END)       AS ok,
        COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)       AS nio,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS mdr
      FROM public.inspection i
      JOIN public.piece p  ON p.id_piece  = i.id_piece
      JOIN public.lot l    ON l.id_lot    = p.id_lot
      JOIN public.client c ON c.id_client = l.id_client
      GROUP BY c.nom_client
      ORDER BY total DESC
    `);
  }

  async getPerfByOperatrice() {
    return this.dataSource.query(`
      SELECT
        o.prenom || ' ' || o.nom                              AS operatrice,
        o.poste,
        COUNT(i.id_inspection)                                AS total,
        COUNT(CASE WHEN i.resultat = 'OK'  THEN 1 END)       AS ok,
        COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)       AS nio,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'OK' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS taux_ok
      FROM public.inspection i
      JOIN public.session_operateur s ON s.id_session  = i.id_operateur
      JOIN public.operateur o         ON o.id_operateur = s.id_operateur
      GROUP BY o.prenom, o.nom, o.poste
      ORDER BY total DESC
      LIMIT 10
    `);
  }

  // ─── ANALYSE PAR LOT ─────────────────────────────────────────

  async getLotsKpis() {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(DISTINCT l.id_lot) AS total_lots,
        COUNT(DISTINCT CASE
          WHEN (
            SELECT COUNT(*) FROM public.piece p2
            JOIN public.inspection i2 ON i2.id_piece = p2.id_piece
            WHERE p2.id_lot = l.id_lot AND i2.resultat = 'NIO'
          )::numeric /
          NULLIF((
            SELECT COUNT(*) FROM public.piece p3
            JOIN public.inspection i3 ON i3.id_piece = p3.id_piece
            WHERE p3.id_lot = l.id_lot
          ), 0) * 100 > 15
          THEN l.id_lot END
        ) AS lots_critiques,
        ROUND(AVG(
          (SELECT COUNT(*) FROM public.piece p4
           JOIN public.inspection i4 ON i4.id_piece = p4.id_piece
           WHERE p4.id_lot = l.id_lot AND i4.resultat = 'NIO')::numeric /
          NULLIF((
            SELECT COUNT(*) FROM public.piece p5
            JOIN public.inspection i5 ON i5.id_piece = p5.id_piece
            WHERE p5.id_lot = l.id_lot
          ), 0) * 100
        ), 1) AS mdr_moyen
      FROM public.lot l
    `);
    return result[0];
  }

  async getLotsList(client?: string, statut?: string, startDate?: string, endDate?: string) {
    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;
    if (client)    { where += ` AND c.id_client = $${idx++}`;       params.push(client); }
    if (statut)    { where += ` AND l.statut_lot = $${idx++}`;      params.push(statut); }
    if (startDate) { where += ` AND l.date_reception >= $${idx++}`; params.push(startDate); }
    if (endDate)   { where += ` AND l.date_reception <= $${idx++}`; params.push(endDate); }

    return this.dataSource.query(`
      SELECT
        l.id_lot,
        c.nom_client                                           AS client,
        l.date_reception,
        l.statut_lot,
        COUNT(DISTINCT p.id_piece)                            AS total_pieces,
        COUNT(CASE WHEN i.resultat = 'OK'  THEN 1 END)        AS ok,
        COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)        AS nio,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS mdr
      FROM public.lot l
      JOIN public.client c     ON c.id_client = l.id_client
      LEFT JOIN public.piece p      ON p.id_lot    = l.id_lot
      LEFT JOIN public.inspection i ON i.id_piece  = p.id_piece
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
        c.nom_client                                           AS client,
        l.date_reception,
        l.statut_lot,
        COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)        AS nio,
        COUNT(i.id_inspection)                                 AS total,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS mdr
      FROM public.lot l
      JOIN public.client c     ON c.id_client = l.id_client
      LEFT JOIN public.piece p      ON p.id_lot    = l.id_lot
      LEFT JOIN public.inspection i ON i.id_piece  = p.id_piece
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
        l.date_reception, l.statut_lot,
        COUNT(DISTINCT p.id_piece)                            AS total_pieces,
        COUNT(CASE WHEN i.resultat = 'OK'  THEN 1 END)        AS ok,
        COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)        AS nio,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS mdr
      FROM public.lot l
      JOIN public.client c     ON c.id_client = l.id_client
      LEFT JOIN public.piece p      ON p.id_lot    = l.id_lot
      LEFT JOIN public.inspection i ON i.id_piece  = p.id_piece
      WHERE l.id_lot = $1
      GROUP BY l.id_lot, c.nom_client, l.date_reception, l.statut_lot
    `, [idLot]);

    const defects = await this.dataSource.query(`
      SELECT d.type_defaut, d.gravite, COUNT(*) AS total
      FROM public.defaut d
      JOIN public.inspection i ON i.id_inspection = d.id_inspection
      JOIN public.piece p      ON p.id_piece      = i.id_piece
      WHERE p.id_lot = $1
      GROUP BY d.type_defaut, d.gravite
      ORDER BY total DESC
    `, [idLot]);

    return { ...lot, defects };
  }

  // ─── TRAÇABILITÉ ─────────────────────────────────────────────

  async searchPieces(filters: any) {
    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (filters.q) {
      where += ` AND (p.id_piece::text ILIKE $${idx} OR p.reference_piece ILIKE $${idx})`;
      params.push(`%${filters.q}%`); idx++;
    }
    if (filters.client)    { where += ` AND c.id_client = $${idx++}`;       params.push(filters.client); }
    if (filters.lot)       { where += ` AND l.id_lot ILIKE $${idx++}`;      params.push(`%${filters.lot}%`); }
    if (filters.result)    { where += ` AND i.resultat = $${idx++}`;         params.push(filters.result); }
    if (filters.startDate) { where += ` AND i.date_inspection >= $${idx++}`; params.push(filters.startDate); }
    if (filters.endDate)   { where += ` AND i.date_inspection <= $${idx++}`; params.push(filters.endDate); }

    return this.dataSource.query(`
      SELECT
        p.id_piece,
        p.reference_piece,
        p.nom_piece,
        l.id_lot,
        c.nom_client       AS client,
        i.id_inspection,
        i.date_inspection,
        i.resultat,
        i.confidence,
        i.image_path,
        COUNT(d.id_defaut) AS nb_defauts
      FROM public.piece p
      JOIN public.lot l         ON l.id_lot        = p.id_lot
      JOIN public.client c      ON c.id_client     = l.id_client
      LEFT JOIN public.inspection i ON i.id_piece  = p.id_piece
      LEFT JOIN public.defaut d     ON d.id_inspection = i.id_inspection
      ${where}
      GROUP BY p.id_piece, p.reference_piece, p.nom_piece,
               l.id_lot, c.nom_client, i.id_inspection,
               i.date_inspection, i.resultat, i.confidence, i.image_path
      ORDER BY i.date_inspection DESC
      LIMIT 100
    `, params);
  }

  async getPieceDetail(id: string) {
    const [piece] = await this.dataSource.query(`
      SELECT
        p.id_piece, p.reference_piece, p.nom_piece,
        l.id_lot, l.date_reception, l.statut_lot,
        c.nom_client      AS client,
        i.id_inspection,  i.date_inspection, i.resultat,
        i.confidence,     i.image_path,      i.shap_image_path,
        i.bbox_x, i.bbox_y, i.bbox_w, i.bbox_h,
        i.model_version
      FROM public.piece p
      JOIN public.lot l         ON l.id_lot       = p.id_lot
      JOIN public.client c      ON c.id_client    = l.id_client
      LEFT JOIN public.inspection i ON i.id_piece = p.id_piece
      WHERE p.id_piece = $1
      ORDER BY i.date_inspection DESC
      LIMIT 1
    `, [id]);

    const defauts = await this.dataSource.query(`
      SELECT d.type_defaut, d.gravite, COUNT(*) AS total
      FROM public.defaut d
      JOIN public.inspection i ON i.id_inspection = d.id_inspection
      WHERE i.id_piece = $1
      GROUP BY d.type_defaut, d.gravite
      ORDER BY total DESC
    `, [id]);

    return { ...piece, defauts };
  }

  // ─── IMAGES NIO ──────────────────────────────────────────────

  async getNioImages(filters: any) {
    let where = `WHERE i.resultat = 'NIO' AND i.image_path IS NOT NULL`;
    const params: any[] = [];
    let idx = 1;

    if (filters.client) {
      where += ` AND c.id_client = $${idx++}`;
      params.push(filters.client);
    }
    if (filters.defect) {
      where += ` AND EXISTS (
        SELECT 1 FROM public.defaut d2
        WHERE d2.id_inspection = i.id_inspection
        AND d2.type_defaut = $${idx++})`;
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
        i.shap_image_path,
        STRING_AGG(DISTINCT d.type_defaut, ', ') AS defauts,
        STRING_AGG(DISTINCT d.gravite, ', ')     AS gravites,
        COUNT(d.id_defaut)                       AS nb_defauts
      FROM public.inspection i
      JOIN public.piece p  ON p.id_piece  = i.id_piece
      JOIN public.lot l    ON l.id_lot    = p.id_lot
      JOIN public.client c ON c.id_client = l.id_client
      LEFT JOIN public.defaut d ON d.id_inspection = i.id_inspection
      ${where}
      GROUP BY i.id_inspection, i.id_piece, p.reference_piece,
               l.id_lot, c.nom_client, i.date_inspection,
               i.confidence, i.image_path, i.shap_image_path
      ORDER BY i.date_inspection DESC
      LIMIT 200
    `, params);
  }

  async getNioImageDetail(id: string) {
    const [inspection] = await this.dataSource.query(`
      SELECT
        i.id_inspection, i.id_piece,
        p.reference_piece, p.nom_piece,
        l.id_lot, l.date_reception,
        c.nom_client AS client,
        i.date_inspection, i.resultat, i.confidence,
        i.image_path, i.shap_image_path,
        i.bbox_x, i.bbox_y, i.bbox_w, i.bbox_h,
        i.model_version
      FROM public.inspection i
      JOIN public.piece p  ON p.id_piece  = i.id_piece
      JOIN public.lot l    ON l.id_lot    = p.id_lot
      JOIN public.client c ON c.id_client = l.id_client
      WHERE i.id_inspection = $1
    `, [id]);

    const defauts = await this.dataSource.query(`
      SELECT type_defaut, gravite
      FROM public.defaut
      WHERE id_inspection = $1
      ORDER BY gravite DESC
    `, [id]);

    return { ...inspection, defauts };
  }

  // ─── RAPPORT ─────────────────────────────────────────────────

  async getPieceRapport(id: string) {
    return this.getPieceDetail(id);
  }

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
        <p><strong>Résultat :</strong> ${rapport.resultat}</p>
        <p><strong>Lot :</strong> ${rapport.id_lot}</p>
        <p><strong>Client :</strong> ${rapport.client}</p>
        <p><strong>Date :</strong> ${rapport.date_inspection}</p>
        <p>Consultez le dashboard pour les détails complets.</p>
      `,
    });

    return { success: true };
  }
}
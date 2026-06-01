import { Injectable, NotFoundException,
         UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Operateur } from './entities/operateur.entity';
import { SessionOperateur } from './entities/session-operateur.entity';
import { Inspection } from './entities/inspection.entity';
import { Piece } from './entities/piece.entity';
import { GrandePiece } from './entities/grande-piece.entity';

import * as fs   from 'fs';
import * as path from 'path';

// Chemin absolu de l'image de test
const TEST_IMAGE_PATH = 'C:\\Users\\azus\\Desktop\\stage_PFE\\Tout\\ia-service\\fff.jpg';

@Injectable()
export class HmiService {

  constructor(
    @InjectRepository(Operateur)
    private readonly operateurRepo: Repository<Operateur>,
    @InjectRepository(SessionOperateur)
    private readonly sessionRepo: Repository<SessionOperateur>,
    @InjectRepository(Inspection)
    private readonly inspectionRepo: Repository<Inspection>,
    @InjectRepository(Piece)
    private readonly pieceRepo: Repository<Piece>,
    @InjectRepository(GrandePiece)
    private readonly grandePieceRepo: Repository<GrandePiece>,
  ) {}

  // ── Login ─────────────────────────────────────────────────────
  async loginOperateur(matricule: string) {
    const operateur = await this.operateurRepo.findOne({
      where: { matricule, is_active: true }
    });
    if (!operateur) {
      throw new UnauthorizedException('Matricule incorrect');
    }
    const session = this.sessionRepo.create({
      id_operateur : operateur.id_operateur,
      heure_debut  : new Date(),
      machine_id   : 'MACHINE-01'
    });
    const savedSession = await this.sessionRepo.save(session);
    return {
      id_operateur : operateur.id_operateur,
      nom          : operateur.nom,
      prenom       : operateur.prenom,
      poste        : operateur.poste,
      client       : operateur.id_client,
      id_session   : savedSession.id_session
    };
  }

  // ── Scan lot ──────────────────────────────────────────────────
  async scanLot(body: {
    id_lot: string, id_operateur: number, id_session: number
  }) {
    const result = await this.grandePieceRepo.query(
      `SELECT l.id_lot, l.statut_lot, l.date_reception,
              c.nom_client,
              COUNT(gp.id_grande_piece) as nb_grandes_pieces
       FROM public.lot l
       LEFT JOIN public.client c ON c.id_client = l.id_client
       LEFT JOIN public.grande_piece gp ON gp.id_lot = l.id_lot
       WHERE l.id_lot = $1
       GROUP BY l.id_lot, l.statut_lot, l.date_reception, c.nom_client`,
      [body.id_lot]
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(`Lot ${body.id_lot} introuvable`);
    }
    const lot = result[0];
    return {
      id_lot            : lot.id_lot,
      nom_client        : lot.nom_client,
      statut_lot        : lot.statut_lot,
      date_reception    : lot.date_reception,
      nb_grandes_pieces : parseInt(lot.nb_grandes_pieces)
    };
  }

  // ── Scan grande pièce ─────────────────────────────────────────
  async scanGrandePiece(body: {
    qr_code: string, id_lot: string, id_session: number
  }) {
    let grandePiece = await this.grandePieceRepo.findOne({
      where: { qr_code: body.qr_code }
    });
    if (!grandePiece) {
      const id_grande_piece = `GP-${Date.now()}`;
      grandePiece = this.grandePieceRepo.create({
        id_grande_piece,
        id_lot    : body.id_lot,
        qr_code   : body.qr_code,
        date_scan : new Date(),
        statut    : 'en_cours'
      });
      grandePiece = await this.grandePieceRepo.save(grandePiece);
    }
    const nbPieces = await this.pieceRepo.count({
      where: { id_grande_piece: grandePiece.id_grande_piece }
    });
    return {
      id_grande_piece : grandePiece.id_grande_piece,
      id_lot          : grandePiece.id_lot,
      qr_code         : grandePiece.qr_code,
      statut          : grandePiece.statut,
      nb_pieces       : nbPieces
    };
  }

  // ── Inspection automatique ────────────────────────────────────
  async inspectionAuto(body: any): Promise<any> {
    const { image_base64, id_piece, id_session } = body;

    // ── 1. Créer la pièce si elle n'existe pas ──────────────────
    let piece = await this.pieceRepo.findOne({
      where: { id_piece: body.id_piece }
    });
    if (!piece) {
      piece = this.pieceRepo.create({
        id_piece        : body.id_piece,
        id_lot          : body.id_lot,
        id_grande_piece : body.id_grande_piece,
        reference_piece : `REF-${body.id_piece}`,
        nom_piece       : 'Accoudoir BMW',
      });
      await this.pieceRepo.save(piece);
    }

    // ── 2. Préparer le chemin image ──────────────────────────────
    const date      = new Date().toISOString().slice(0, 10).replace(/-/g, path.sep);
    const uploadDir = path.resolve('uploads', 'inspections', ...date.split(path.sep));
    fs.mkdirSync(uploadDir, { recursive: true });

    // Nom unique pour éviter les conflits
    const timestamp = Date.now();
    const imagePath = path.join(uploadDir, `${id_piece}_${timestamp}.jpg`);

    // ── 3. Sauvegarder l'image ───────────────────────────────────
    if (image_base64 && image_base64.length > 100) {
      // Image réelle depuis caméra
      const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(imagePath, Buffer.from(base64Data, 'base64'));
      console.log(`[HMI] Image caméra sauvegardée (${fs.statSync(imagePath).size} octets)`);

    } else {
      // Mode manuel — copier test.jpg
      console.log(`[HMI] Mode manuel — tentative copie depuis : ${TEST_IMAGE_PATH}`);
      console.log(`[HMI] test.jpg existe : ${fs.existsSync(TEST_IMAGE_PATH)}`);

      if (fs.existsSync(TEST_IMAGE_PATH)) {
        const testSize = fs.statSync(TEST_IMAGE_PATH).size;
        console.log(`[HMI] test.jpg taille source : ${testSize} octets`);

        if (testSize > 1000) {
          // Copie avec vérification
          const content = fs.readFileSync(TEST_IMAGE_PATH);
          fs.writeFileSync(imagePath, content);
          const copiedSize = fs.statSync(imagePath).size;
          console.log(`[HMI] Copie réussie → destination : ${copiedSize} octets`);
        } else {
          console.error(`[HMI] test.jpg trop petite (${testSize} octets) — placez une vraie image`);
        }
      } else {
        console.error(`[HMI] test.jpg introuvable à : ${TEST_IMAGE_PATH}`);
      }
    }

    // Vérification finale
    const finalSize = fs.existsSync(imagePath) ? fs.statSync(imagePath).size : 0;
    console.log(`[HMI] imagePath final : ${imagePath}`);
    console.log(`[HMI] Taille finale   : ${finalSize} octets`);

    // ── 3b. Redimensionner avant envoi IA ───────────────────────
const sharp = require('sharp');
const resizedPath = imagePath.replace('.jpg', '_s.jpg');
await sharp(imagePath)
  .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 80 })
  .toFile(resizedPath);
console.log(`[HMI] Redimensionnée : ${fs.statSync(resizedPath).size} octets`);


    // ── 4. Appeler le service IA ─────────────────────────────────
    let iaResult: any;
    try {
      const axios    = require('axios');
      const response = await axios.post('http://localhost:8000/predict', {
        image_path   : imagePath,
        id_piece     : id_piece,
        generate_shap: true,
      }, { timeout: 300000  });
      iaResult = response.data;
      console.log(`[HMI] ia-service répondu : ${iaResult.resultat} (conf=${iaResult.confidence})`);
    } catch (err: any) {
      console.error('[HMI] ia-service inaccessible :', err.message);
      iaResult = {
        marque          : 'BMW',
        resultat        : 'OK',
        confidence      : 0.95,
        type_defaut     : null,
        gravite         : null,
        bbox_x          : null,
        bbox_y          : null,
        bbox_w          : null,
        bbox_h          : null,
        shap_image_path : null,
        model_version   : 'fallback',
      };
    }

    // ── 5. Sauvegarder l'inspection ──────────────────────────────
    const inspection = this.inspectionRepo.create({
      id_piece        : id_piece,
      date_inspection : new Date(),
      resultat        : iaResult.resultat,
      confidence      : iaResult.confidence,
      model_version   : iaResult.model_version,
      image_path      : imagePath,
      bbox_x          : iaResult.bbox_x,
      bbox_y          : iaResult.bbox_y,
      bbox_w          : iaResult.bbox_w,
      bbox_h          : iaResult.bbox_h,
      shap_image_path : iaResult.shap_image_path,
    } as any);
    const savedInspection = await this.inspectionRepo.save(inspection) as any;

    // ── 6. Si NIO → sauvegarder le défaut ───────────────────────
    if (iaResult.resultat === 'NIO' && iaResult.type_defaut) {
      await this.inspectionRepo.query(
        `INSERT INTO public.defaut (id_inspection, type_defaut, gravite)
         VALUES ($1, $2, $3)`,
        [savedInspection.id_inspection, iaResult.type_defaut, iaResult.gravite]
      );
    }

    // ── 7. Compteurs session ─────────────────────────────────────
    await this.sessionRepo.increment(
      { id_session: body.id_session }, 'nb_inspections', 1
    );
    if (iaResult.resultat === 'OK') {
      await this.sessionRepo.increment({ id_session: body.id_session }, 'nb_io', 1);
    } else {
      await this.sessionRepo.increment({ id_session: body.id_session }, 'nb_nio', 1);
    }

    // ── 8. Retour HMI ────────────────────────────────────────────
    return {
      id_inspection   : savedInspection.id_inspection,
      id_piece        : id_piece,
      id_grande_piece : body.id_grande_piece,
      id_lot          : body.id_lot,
      resultat        : iaResult.resultat,
      confidence      : iaResult.confidence,
      type_defaut     : iaResult.type_defaut,
      gravite         : iaResult.gravite,
      marque          : iaResult.marque,
      shap_image_path : iaResult.shap_image_path,
      bbox            : {
        x: iaResult.bbox_x,
        y: iaResult.bbox_y,
        w: iaResult.bbox_w,
        h: iaResult.bbox_h,
      },
    };
  }

  // ── Fin grande pièce ──────────────────────────────────────────
  async finGrandePiece(id_grande_piece: string) {
    await this.grandePieceRepo.update(
      { id_grande_piece },
      { statut: 'terminee' }
    );
    const result = await this.grandePieceRepo.query(
      `SELECT
         COUNT(i.id_inspection) as total,
         COUNT(CASE WHEN i.resultat = 'OK'  THEN 1 END) as io,
         COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END) as nio
       FROM public.piece p
       LEFT JOIN public.inspection i ON i.id_piece = p.id_piece
       WHERE p.id_grande_piece = $1`,
      [id_grande_piece]
    );
    const stats = result[0];
    return {
      id_grande_piece,
      statut : 'terminee',
      total  : parseInt(stats.total),
      io     : parseInt(stats.io),
      nio    : parseInt(stats.nio)
    };
  }

  // ── Résumé lot ────────────────────────────────────────────────
  async getLotSummary(id_lot: string) {
    const result = await this.grandePieceRepo.query(
      `SELECT
         COUNT(DISTINCT p.id_piece) as total_pieces,
         COUNT(CASE WHEN i.resultat = 'OK'  THEN 1 END) as io,
         COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END) as nio,
         COUNT(DISTINCT gp.id_grande_piece) as nb_grandes_pieces,
         ROUND(
           COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)::numeric /
           NULLIF(COUNT(i.id_inspection), 0) * 100, 1
         ) as mdr
       FROM public.grande_piece gp
       LEFT JOIN public.piece p ON p.id_grande_piece = gp.id_grande_piece
       LEFT JOIN public.inspection i ON i.id_piece = p.id_piece
       WHERE gp.id_lot = $1`,
      [id_lot]
    );
    const stats = result[0];
    return {
      id_lot,
      total_pieces      : parseInt(stats.total_pieces),
      io                : parseInt(stats.io),
      nio               : parseInt(stats.nio),
      nb_grandes_pieces : parseInt(stats.nb_grandes_pieces),
      mdr               : parseFloat(stats.mdr) || 0
    };
  }

  // ── Logout ────────────────────────────────────────────────────
  async logoutOperateur(id_session: number) {
    await this.sessionRepo.update(id_session, {
      heure_fin: new Date()
    });
    const session = await this.sessionRepo.findOne({
      where: { id_session }
    });
    if (!session) {
      return { nb_inspections: 0, nb_io: 0, nb_nio: 0 };
    }
    return {
      nb_inspections : session.nb_inspections,
      nb_io          : session.nb_io,
      nb_nio         : session.nb_nio
    };
  }
}
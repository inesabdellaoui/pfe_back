import { Entity, PrimaryColumn, Column,
         ManyToOne, JoinColumn, OneToMany } from 'typeorm';

@Entity({ name: 'grande_piece', schema: 'public' })
export class GrandePiece {

  @PrimaryColumn()
  id_grande_piece: string;

  @Column()
  id_lot: string;

  @Column({ nullable: true })
  qr_code: string;

  @Column({ nullable: true })
  date_scan: Date;

  @Column({ default: 'en_cours' })
  statut: string;  // en_cours / terminee

}
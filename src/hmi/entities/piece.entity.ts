import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'piece', schema: 'public' })
export class Piece {

  @PrimaryColumn()
  id_piece: string;

  @Column({ nullable: true })
  id_lot: string;

  @Column({ nullable: true })
  id_grande_piece: string;

  @Column({ nullable: true })
  reference_piece: string;

  @Column({ nullable: true })
  nom_piece: string;
}
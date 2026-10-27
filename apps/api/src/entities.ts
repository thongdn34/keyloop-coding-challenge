import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity()
export class Dealership {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  city!: string;
}

@Entity()
export class Customer {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  email!: string;
}

@Entity()
export class Vehicle {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  customerId!: number;

  @ManyToOne(() => Customer, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "customerId" })
  customer!: Customer;

  @Column()
  make!: string;

  @Column()
  model!: string;

  @Column()
  registration!: string;
}

@Entity()
export class ServiceType {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  durationMinutes!: number;
}

@Entity()
export class ServiceBay {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  dealershipId!: number;

  @ManyToOne(() => Dealership, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "dealershipId" })
  dealership!: Dealership;

  @Column()
  name!: string;

  @Column({ default: true })
  active!: boolean;
}

@Entity()
export class Technician {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  dealershipId!: number;

  @ManyToOne(() => Dealership, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "dealershipId" })
  dealership!: Dealership;

  @Column()
  name!: string;

  @Column({ default: true })
  active!: boolean;
}

@Entity()
export class TechnicianSkill {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  technicianId!: number;

  @ManyToOne(() => Technician, { onDelete: "CASCADE" })
  @JoinColumn({ name: "technicianId" })
  technician!: Technician;

  @Column()
  serviceTypeId!: number;

  @ManyToOne(() => ServiceType, { onDelete: "CASCADE" })
  @JoinColumn({ name: "serviceTypeId" })
  serviceType!: ServiceType;
}

@Entity()
export class Appointment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  dealershipId!: number;

  @ManyToOne(() => Dealership, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "dealershipId" })
  dealership!: Dealership;

  @Column()
  customerId!: number;

  @ManyToOne(() => Customer, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "customerId" })
  customer!: Customer;

  @Column()
  vehicleId!: number;

  @ManyToOne(() => Vehicle, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "vehicleId" })
  vehicle!: Vehicle;

  @Column()
  serviceTypeId!: number;

  @ManyToOne(() => ServiceType, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "serviceTypeId" })
  serviceType!: ServiceType;

  @Column()
  technicianId!: number;

  @ManyToOne(() => Technician, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "technicianId" })
  technician!: Technician;

  @Column()
  serviceBayId!: number;

  @ManyToOne(() => ServiceBay, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "serviceBayId" })
  serviceBay!: ServiceBay;

  @Column({ type: "timestamptz" })
  startAt!: Date;

  @Column({ type: "timestamptz" })
  endAt!: Date;

  @Column({ default: "confirmed" })
  status!: string;
}

export const entities = [
  Dealership,
  Customer,
  Vehicle,
  ServiceType,
  ServiceBay,
  Technician,
  TechnicianSkill,
  Appointment,
];

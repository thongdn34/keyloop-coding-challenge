import {Entity,PrimaryGeneratedColumn,Column} from 'typeorm';
@Entity() export class Dealership {@PrimaryGeneratedColumn() id!:number;@Column() name!:string;@Column() city!:string;}
@Entity() export class Customer {@PrimaryGeneratedColumn() id!:number;@Column() name!:string;@Column() email!:string;}
@Entity() export class Vehicle {@PrimaryGeneratedColumn() id!:number;@Column() customerId!:number;@Column() make!:string;@Column() model!:string;@Column() registration!:string;}
@Entity() export class ServiceType {@PrimaryGeneratedColumn() id!:number;@Column() name!:string;@Column() durationMinutes!:number;}
@Entity() export class ServiceBay {@PrimaryGeneratedColumn() id!:number;@Column() dealershipId!:number;@Column() name!:string;@Column({default:true}) active!:boolean;}
@Entity() export class Technician {@PrimaryGeneratedColumn() id!:number;@Column() dealershipId!:number;@Column() name!:string;@Column({default:true}) active!:boolean;}
@Entity() export class TechnicianSkill {@PrimaryGeneratedColumn() id!:number;@Column() technicianId!:number;@Column() serviceTypeId!:number;}
@Entity() export class Appointment {@PrimaryGeneratedColumn() id!:number;@Column() dealershipId!:number;@Column() customerId!:number;@Column() vehicleId!:number;@Column() serviceTypeId!:number;@Column() technicianId!:number;@Column() serviceBayId!:number;@Column({type:'timestamptz'}) startAt!:Date;@Column({type:'timestamptz'}) endAt!:Date;@Column({default:'confirmed'}) status!:string;}
export const entities=[Dealership,Customer,Vehicle,ServiceType,ServiceBay,Technician,TechnicianSkill,Appointment];
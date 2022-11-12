import { DEFAULT_SETTINGS } from "../constants";
import { Plugin, Notice } from "obsidian";
import { SettingsTab } from ".";
import { IPostgresPluginSettings } from "../types/plugin-settings";
import { DataviewApi, getAPI } from "obsidian-dataview";
import { Client } from "pg";
import moment from 'moment';

export class PostgreSQLPlugin extends Plugin {
	public settings: IPostgresPluginSettings;
	protected db: Client | undefined;

	public async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new SettingsTab(this.app, this));

		const dv: DataviewApi = getAPI();
		this.addCommand({
			id: "postgresql-upload-current-file",
			name: "PostgreSQL: upload current file information",
			callback: async () => {
				const db: Client = await this.getDatabaseClient();

				const filepath: string =
					this.app.workspace.getActiveFile().path;
				const dataviewData: Record<string, unknown> = dv.page(filepath);
				const fileMetadata = dataviewData.file;
				const fileContent: string = await dv.io.load(filepath);
				const timestamp = moment(new Date()).format('YYYY-MM-DD hh:mm:ssZ');

				delete dataviewData.file;
				delete dataviewData.position;

				try {
					await db.query(
						`INSERT INTO obsidian.file (path, timestamp, file_metadata, dataview_metadata, file_content)
						VALUES ($1::text, $2::timestamp, $3::json, $4::json, $5::text)
						;
						`,
						[filepath, timestamp, fileMetadata, dataviewData, fileContent]
					);
				} catch (err) {
					// eslint-disable-next-line no-new
					new Notice("PostgreSQL error: " + err.message);
					throw err;
				}

				// eslint-disable-next-line no-new
				new Notice("Inserted page");
			},
		});

		this.addCommand({
			id: "postgresql-upload-modified-files",
			name: "PostgreSQL: upload modified files information",
			callback: async () => {
				const db: Client = await this.getDatabaseClient();

				const lastTimestamp = await db.query("SELECT max(timestamp) FROM obsidian.file");
				const pages = dv.pages()
					.filter(page => new Date(page.file.mtime) >= lastTimestamp.rows[0].max)
									
				pages.map(async page => {
					const filepath: string = page.file.path;
					const dataviewData: Record<string, unknown> = page;
					const fileMetadata = dataviewData.file;
					const fileContent: string = await dv.io.load(filepath);
					const timestamp = moment(new Date()).format('YYYY-MM-DD HH:mm:ssZ');

					delete dataviewData.file;
					delete dataviewData.position;

					try {
						await db.query(
							`INSERT INTO obsidian.file (path, timestamp, file_metadata, dataview_metadata, file_content)
							VALUES ($1::text, $2::timestamp, $3::json, $4::json, $5::text)
							;
							`,
							[filepath, timestamp, fileMetadata, dataviewData, fileContent]
						);
					} catch (err) {
						// eslint-disable-next-line no-new
						new Notice("PostgreSQL error: " + err.message);
						throw err;
					}
				})
				

				// eslint-disable-next-line no-new
				new Notice(pages.length + " pages inserted");
			},
		});
		
	}

	/**
	 * Connect to the PostgreSQL database and return the database client
	 * @returns
	 */
	public async getDatabaseClient(): Promise<Client> {
		if (!this.settings.connectionUrl) {
			// eslint-disable-next-line no-new
			new Notice("PostgreSQL: there is no connection string defined");
			throw new Error("No connection string");
		}

		if (this.db) {
			return this.db;
		}

		const client: Client = new Client({
			connectionString: this.settings.connectionUrl,
			connectionTimeoutMillis: 10000,
		});
		try {
			await client.connect();
			// eslint-disable-next-line no-new
			new Notice("Connected to PostgreSQL");
		} catch (err) {
			// eslint-disable-next-line no-new
			new Notice("PostgreSQL connection error: " + err.message);
			throw err;
		}

		this.db = client;

		await this.db.query(
			`CREATE SCHEMA IF NOT EXISTS obsidian;
			CREATE TABLE IF NOT EXISTS obsidian.file (
					path text,
					timestamp timestamp,
					file_metadata json,
					dataview_metadata json,
					file_content text

			);`
		);

		return this.db;
	}

	public async onunload(): Promise<void> {
		await this.db?.end();
	}

	public async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	public async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

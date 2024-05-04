const { DataSource } = require('typeorm');
const { BracketsManager, entity } = require('brackets-manager');
const { MongoDataSource } = require('typeorm/datasource/MongoDataSource');
const mongoose = require('mongoose');

// Define the data source for MongoDB
const mongourl = 'YOUR_MONGODB_URL'; // Replace with your MongoDB URL

const dataSource = new MongoDataSource({
    type: "mongodb",
    url: mongourl,
    useNewUrlParser: true,
    useUnifiedTopology: true,
    synchronize: true,
    entities: [entity.Participant, entity.Stage, entity.Group, entity.Round, entity.Match, entity.MatchGame, entity.Game]
});

// Initialize data source and bracket manager
async function setupDataSource() {
    await dataSource.initialize();
    const manager = new BracketsManager(dataSource);

    return manager;
}

async function setupTournament(manager) {
    const stage = {
        name: 'Tournament Stage',
        tournamentId: 1,
        type: 'single_elimination',
        settings: { size: 8, seedOrdering: ['natural'] }
    };

    // Create tournament stage
    await manager.create(stage);

    // Simulate adding participants
    const participants = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: Player ${i + 1} }));
    await dataSource.getRepository(entity.Participant).save(participants.map(p => ({ ...p, tournamentId: stage.tournamentId })));

    // Start the tournament
    await manager.start(stage.tournamentId);
}

async function getTournamentStatus(manager, tournamentId) {
    const matches = await dataSource.getRepository(entity.Match).find({
        where: { tournamentId: tournamentId },
        relations: ['participants']
    });

    const participants = await dataSource.getRepository(entity.Participant).find({
        where: { tournamentId: tournamentId }
    });

    const status = participants.map(participant => ({
        id: participant.id,
        name: participant.name,
        credits: participant.customFields?.credits || 100,
        matches: matches.filter(match => match.participants.includes(participant.id))
    }));

    return status;
}

async function main() {
    const manager = await setupDataSource();
    await setupTournament(manager);

    // Get current tournament status
    const status = await getTournamentStatus(manager, 1);
    console.log(JSON.stringify(status, null, 2));
}

main().catch(err => console.error(err));
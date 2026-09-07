const msg = "Could not find the 'advancing' table in the schema cache";
console.log(/Could not find the table/i.test(msg));
console.log(/relation .+ does not exist/i.test(msg));
console.log(/schema cache/i.test(msg));
